from __future__ import annotations

import re

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error

DATA_PATH = "./data/data.csv"
MODEL_PATH = "lightgbm_collision_model.pkl"

def normalize_location(text: str) -> str:
    if pd.isna(text):
        return "unknown"

    text = str(text)

    # normalize unicode / hidden chars
    text = text.replace("\u00a0", " ")   # non-breaking space
    text = text.replace("–", "-")
    text = text.replace("—", "-")
    text = text.replace("&amp;", "&")

    # standardize spacing
    text = re.sub(r"\s+", " ", text).strip()

    # standardize "between"/"near" formatting a bit
    text = re.sub(r"\s*&\s*", " & ", text)
    text = re.sub(r"\s*-\s*", " - ", text)
    text = re.sub(r"\s+", " ", text).strip()

    # lowercase for stable matching
    text = text.lower()

    return text

RAW_LOCATION_COORDS = {
    "Jasper Ave & 109 St NW": {"lat": 53.5390, "lng": -113.5080},
    "Whyte Ave & 99 St NW": {"lat": 53.5224, "lng": -113.4935},
    "Whitemud Dr & 170 St NW": {"lat": 53.5003, "lng": -113.6243},
    "Jasper Ave & 124 St NW": {"lat": 53.5407, "lng": -113.5368},
    "Kingsway Ave & 109 St NW": {"lat": 53.5634, "lng": -113.5078},
    "23 Ave & 91 St NW": {"lat": 53.4538, "lng": -113.4689},
    "Terwillegar Dr & 23 Ave SW": {"lat": 53.4558, "lng": -113.5840},
    "Groat Rd & Valleyview Dr NW": {"lat": 53.5416, "lng": -113.5463},
    "Fort Rd & 118 Ave NW": {"lat": 53.5707, "lng": -113.4504},
    "Calgary Trail & 51 Ave NW": {"lat": 53.4887, "lng": -113.4928},
    "Gateway Blvd & 23 Ave NW": {"lat": 53.4548, "lng": -113.4943},
    "Whitemud Dr & 91 St NW": {"lat": 53.4888, "lng": -113.4680},
    "137 Ave & 97 St NW": {"lat": 53.5997, "lng": -113.4898},
    "Anthony Henday Dr & 66 St NW": {"lat": 53.6030, "lng": -113.4420},
    "Manning Dr & 137 Ave NW": {"lat": 53.6006, "lng": -113.4292},

    "Fort Rd NW between 118 Ave & 137 Ave": {"lat": 53.5820, "lng": -113.4460},
    "118 Ave & 82 St NW": {"lat": 53.5713, "lng": -113.4488},
    "Yellowhead Trail NW between 97 St & 82 St": {"lat": 53.5798, "lng": -113.4705},
    "Stony Plain Rd & 149 St NW": {"lat": 53.5409, "lng": -113.5792},
    "Stony Plain Rd NW between 149 St & 163 St": {"lat": 53.5413, "lng": -113.5925},
    "Groat Rd NW between River Valley Rd & 107 Ave": {"lat": 53.5520, "lng": -113.5330},
    "118 Ave NW between 82 St & 97 St": {"lat": 53.5714, "lng": -113.4687},
    "Anthony Henday Dr NW near 23 Ave": {"lat": 53.4585, "lng": -113.6120},
    "82 Ave NW between Gateway Blvd & 109 St": {"lat": 53.5187, "lng": -113.5002},
    "Whitemud Dr NW between 91 St & 119 St": {"lat": 53.4895, "lng": -113.5050},
    "Calgary Trail NW between 51 Ave & 34 Ave": {"lat": 53.4802, "lng": -113.4922},
    "107 Ave & 156 St NW": {"lat": 53.5437, "lng": -113.5896},
    "34 Ave & 91 St NW": {"lat": 53.4680, "lng": -113.4688},
    "Yellowhead Trail & 97 St NW": {"lat": 53.5790, "lng": -113.4850},
    "170 St NW between Whitemud Dr & Jasper Ave": {"lat": 53.5205, "lng": -113.6205},
}

LOCATION_COORDS = {
    normalize_location(k): v for k, v in RAW_LOCATION_COORDS.items()
}

def load_data(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, encoding="utf-8-sig")
    df.columns = [c.strip() for c in df.columns]

    required = [
        "Collision Date & Time",
        "Location Description",
        "Location Type",
        "Traffic Control",
        "Pedestrians Involved",
        "Vehicles Involved",
        "Cyclists Involved",
        "Minor Injuries",
        "Major Injuries",
        "Fatalities",
        "Property Damage Only",
    ]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}\nFound columns: {df.columns.tolist()}")

    df["Collision Date & Time"] = pd.to_datetime(df["Collision Date & Time"])
    df["Location Description"] = df["Location Description"].apply(normalize_location)
    df["Location Type"] = df["Location Type"].fillna("Unknown")
    df["Traffic Control"] = df["Traffic Control"].fillna("Unknown")

    numeric_cols = [
        "Pedestrians Involved",
        "Vehicles Involved",
        "Cyclists Involved",
        "Minor Injuries",
        "Major Injuries",
        "Fatalities",
    ]
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    df["Property Damage Only"] = (
        df["Property Damage Only"]
        .astype(str)
        .str.upper()
        .map({"Y": 1, "N": 0})
        .fillna(0)
        .astype(int)
    )

    df["month"] = df["Collision Date & Time"].dt.to_period("M").dt.to_timestamp()
    df["hour"] = df["Collision Date & Time"].dt.hour
    df["is_winter"] = df["Collision Date & Time"].dt.month.isin([11, 12, 1, 2, 3]).astype(int)
    df["is_weekend"] = df["Collision Date & Time"].dt.dayofweek.isin([5, 6]).astype(int)

    return df


def build_monthly_features(df: pd.DataFrame) -> pd.DataFrame:
    monthly = (
        df.groupby(["Location Description", "Location Type", "month"], as_index=False)
        .agg(
            collisions=("Collision Date & Time", "size"),
            pedestrians_involved=("Pedestrians Involved", "sum"),
            cyclists_involved=("Cyclists Involved", "sum"),
            vehicles_involved=("Vehicles Involved", "sum"),
            minor_injuries=("Minor Injuries", "sum"),
            major_injuries=("Major Injuries", "sum"),
            fatalities=("Fatalities", "sum"),
            property_damage_only=("Property Damage Only", "sum"),
            weekend_collisions=("is_weekend", "sum"),
            winter_flag=("is_winter", "max"),
        )
    )

    monthly = monthly.sort_values(["Location Description", "month"]).reset_index(drop=True)

    # fill missing months for each location
    out = []
    for (loc, loc_type), group in monthly.groupby(["Location Description", "Location Type"], sort=False):
        full_months = pd.date_range(group["month"].min(), group["month"].max(), freq="MS")
        full = pd.DataFrame({"month": full_months})
        full["Location Description"] = loc
        full["Location Type"] = loc_type

        full = full.merge(
            group,
            on=["Location Description", "Location Type", "month"],
            how="left",
        )

        fill_cols = [
            "collisions",
            "pedestrians_involved",
            "cyclists_involved",
            "vehicles_involved",
            "minor_injuries",
            "major_injuries",
            "fatalities",
            "property_damage_only",
            "weekend_collisions",
            "winter_flag",
        ]
        full[fill_cols] = full[fill_cols].fillna(0)
        out.append(full)

    monthly = pd.concat(out, ignore_index=True)
    monthly = monthly.sort_values(["Location Description", "month"]).reset_index(drop=True)

    # feature engineering per location
    engineered_groups = []

    for (loc, loc_type), group in monthly.groupby(["Location Description", "Location Type"], sort=False):
        g = group.sort_values("month").copy()

        g["collisions_lag_1"] = g["collisions"].shift(1)
        g["collisions_lag_2"] = g["collisions"].shift(2)
        g["collisions_lag_3"] = g["collisions"].shift(3)

        g["minor_injuries_lag_1"] = g["minor_injuries"].shift(1)
        g["major_injuries_lag_1"] = g["major_injuries"].shift(1)
        g["fatalities_lag_1"] = g["fatalities"].shift(1)

        g["collisions_roll_3"] = g["collisions"].shift(1).rolling(3).sum()
        g["collisions_roll_6"] = g["collisions"].shift(1).rolling(6).sum()
        g["collisions_roll_12"] = g["collisions"].shift(1).rolling(12).sum()

        g["major_injuries_roll_6"] = g["major_injuries"].shift(1).rolling(6).sum()
        g["fatalities_roll_12"] = g["fatalities"].shift(1).rolling(12).sum()
        g["pedestrians_roll_6"] = g["pedestrians_involved"].shift(1).rolling(6).sum()
        g["cyclists_roll_6"] = g["cyclists_involved"].shift(1).rolling(6).sum()

        g["pdo_roll_6"] = g["property_damage_only"].shift(1).rolling(6).sum()
        g["vehicles_roll_3"] = g["vehicles_involved"].shift(1).rolling(3).sum()

        g["trend_3mo"] = (
            g["collisions"].shift(1).rolling(3).mean()
            - g["collisions"].shift(4).rolling(3).mean()
        )

        g["month_num"] = g["month"].dt.month
        g["quarter"] = g["month"].dt.quarter
        g["coverage_months"] = np.arange(1, len(g) + 1)

        # target = next month's collisions
        g["target_next_month"] = g["collisions"].shift(-1)

        engineered_groups.append(g)

    monthly = pd.concat(engineered_groups, ignore_index=True)

    feature_cols_needed = [
        "collisions_lag_1",
        "collisions_lag_2",
        "collisions_lag_3",
        "collisions_roll_3",
        "collisions_roll_6",
        "major_injuries_roll_6",
        "fatalities_roll_12",
        "pedestrians_roll_6",
        "cyclists_roll_6",
        "trend_3mo",
        "target_next_month",
    ]
    monthly = monthly.dropna(subset=feature_cols_needed).reset_index(drop=True)
    monthly["trend_3mo"] = monthly["trend_3mo"].fillna(0)

    print("feature_df columns:", monthly.columns.tolist())

    return monthly

def add_group_features(group: pd.DataFrame) -> pd.DataFrame:
    engineered_groups = []

    for (loc, loc_type), group in monthly.groupby(["Location Description", "Location Type"], sort=False):
        g = group.sort_values("month").copy()

        g["collisions_lag_1"] = g["collisions"].shift(1)
        g["collisions_lag_2"] = g["collisions"].shift(2)
        g["collisions_lag_3"] = g["collisions"].shift(3)

        g["minor_injuries_lag_1"] = g["minor_injuries"].shift(1)
        g["major_injuries_lag_1"] = g["major_injuries"].shift(1)
        g["fatalities_lag_1"] = g["fatalities"].shift(1)

        g["collisions_roll_3"] = g["collisions"].shift(1).rolling(3).sum()
        g["collisions_roll_6"] = g["collisions"].shift(1).rolling(6).sum()
        g["collisions_roll_12"] = g["collisions"].shift(1).rolling(12).sum()

        g["major_injuries_roll_6"] = g["major_injuries"].shift(1).rolling(6).sum()
        g["fatalities_roll_12"] = g["fatalities"].shift(1).rolling(12).sum()
        g["pedestrians_roll_6"] = g["pedestrians_involved"].shift(1).rolling(6).sum()
        g["cyclists_roll_6"] = g["cyclists_involved"].shift(1).rolling(6).sum()

        g["pdo_roll_6"] = g["property_damage_only"].shift(1).rolling(6).sum()
        g["vehicles_roll_3"] = g["vehicles_involved"].shift(1).rolling(3).sum()

        g["trend_3mo"] = (
            g["collisions"].shift(1).rolling(3).mean()
            - g["collisions"].shift(4).rolling(3).mean()
        )

        g["month_num"] = g["month"].dt.month
        g["quarter"] = g["month"].dt.quarter
        g["coverage_months"] = np.arange(1, len(g) + 1)
        g["target_next_month"] = g["collisions"].shift(-1)

        # explicitly preserve grouping columns
        g["Location Description"] = loc
        g["Location Type"] = loc_type

        engineered_groups.append(g)

    monthly = pd.concat(engineered_groups, ignore_index=True)

    feature_cols_needed = [
        "collisions_lag_1",
        "collisions_lag_2",
        "collisions_lag_3",
        "collisions_roll_3",
        "collisions_roll_6",
        "major_injuries_roll_6",
        "fatalities_roll_12",
        "pedestrians_roll_6",
        "cyclists_roll_6",
        "trend_3mo",
        "target_next_month",
    ]
    monthly = monthly.dropna(subset=feature_cols_needed).reset_index(drop=True)
    monthly["trend_3mo"] = monthly["trend_3mo"].fillna(0)

    return monthly


def train_model(feature_df: pd.DataFrame) -> tuple[lgb.LGBMRegressor, list[str], pd.DataFrame]:
    feature_cols = [
        "collisions_lag_1",
        "collisions_lag_2",
        "collisions_lag_3",
        "collisions_roll_3",
        "collisions_roll_6",
        "collisions_roll_12",
        "major_injuries_roll_6",
        "fatalities_roll_12",
        "pedestrians_roll_6",
        "cyclists_roll_6",
        "pdo_roll_6",
        "vehicles_roll_3",
        "trend_3mo",
        "month_num",
        "quarter",
        "winter_flag",
        "coverage_months",
    ]

    X = feature_df[feature_cols]
    y = feature_df["target_next_month"]

    cutoff = feature_df["month"].quantile(0.8)
    train_df = feature_df[feature_df["month"] <= cutoff].copy()
    test_df = feature_df[feature_df["month"] > cutoff].copy()

    X_train = train_df[feature_cols]
    y_train = train_df["target_next_month"]
    X_test = test_df[feature_cols]
    y_test = test_df["target_next_month"]

    model = lgb.LGBMRegressor(
        objective="regression",
        n_estimators=300,
        learning_rate=0.05,
        num_leaves=31,
        max_depth=-1,
        min_child_samples=10,
        subsample=0.9,
        colsample_bytree=0.9,
        random_state=42,
    )

    model.fit(X_train, y_train)

    preds = np.clip(model.predict(X_test), 0, None)

    print("Test MAE :", round(mean_absolute_error(y_test, preds), 4))
    rmse = np.sqrt(mean_squared_error(y_test, preds))
    print("Test RMSE:", round(rmse, 4))

    importances = pd.DataFrame(
        {
            "feature": feature_cols,
            "importance": model.feature_importances_,
        }
    ).sort_values("importance", ascending=False)

    print("\nTop feature importances:")
    print(importances.head(10).to_string(index=False))

    return model, feature_cols, feature_df

def build_latest_predictions(
    model: lgb.LGBMRegressor,
    feature_cols: list[str],
    feature_df: pd.DataFrame,
) -> pd.DataFrame:
    latest = (
        feature_df
        .sort_values(["Location Description", "month"])
        .drop_duplicates(subset=["Location Description", "Location Type"], keep="last")
        .copy()
        .reset_index(drop=True)
    )

    print("build_latest_predictions columns:", latest.columns.tolist())

    latest["predicted_collisions"] = np.clip(model.predict(latest[feature_cols]), 0, None)
    latest["predicted_collisions"] = latest["predicted_collisions"].round(2)

    latest["severe_proxy"] = (
        0.08
        + 0.03 * latest["major_injuries_roll_6"]
        + 0.06 * latest["fatalities_roll_12"]
        + 0.01 * latest["pedestrians_roll_6"]
        + 0.01 * latest["cyclists_roll_6"]
    ).clip(0.05, 0.95)

    pmin = latest["predicted_collisions"].min()
    pmax = latest["predicted_collisions"].max()
    denom = max(pmax - pmin, 1e-6)
    latest["risk_score"] = (
        55 + ((latest["predicted_collisions"] - pmin) / denom) * 40
    ).round().astype(int)

    def band(score: int) -> str:
        if score >= 85:
            return "CRITICAL"
        if score >= 75:
            return "HIGH"
        if score >= 65:
            return "MEDIUM"
        return "LOW"

    latest["band"] = latest["risk_score"].apply(band)
    latest["confidence"] = (
        0.65
        + 0.25 * (latest["coverage_months"].clip(1, 24) / 24.0)
        + 0.10 * (latest["collisions_roll_12"].clip(0, 20) / 20.0)
    ).clip(0.65, 0.95)

    return latest.sort_values("risk_score", ascending=False).reset_index(drop=True)

def attach_coordinates(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["Location Description"] = df["Location Description"].apply(normalize_location)

    df["lat"] = df["Location Description"].map(
        lambda x: LOCATION_COORDS.get(x, {}).get("lat")
    )
    df["lng"] = df["Location Description"].map(
        lambda x: LOCATION_COORDS.get(x, {}).get("lng")
    )

    missing = df[df["lat"].isna() | df["lng"].isna()]["Location Description"].drop_duplicates().tolist()
    if missing:
        print("\nStill missing coordinates:")
        for loc in missing:
            print(repr(loc), " | in dict?", loc in LOCATION_COORDS)

    return df

def pretty_location_name(text: str) -> str:
    return " ".join(word.capitalize() if word not in {"nw", "sw", "ne", "se"} else word.upper()
                    for word in str(text).split())

def build_frontend_json(df: pd.DataFrame) -> list[dict]:
    def band_class(band: str) -> str:
        if band == "CRITICAL":
            return "p-red"
        if band == "HIGH":
            return "p-amb"
        if band == "MEDIUM":
            return "p-blue"
        return "p-mut"

    def band_color(band: str) -> str:
        if band == "CRITICAL":
            return "#e84646"
        if band == "HIGH":
            return "#f5a623"
        if band == "MEDIUM":
            return "#39b6fb"
        return "#7a92ab"

    rows = []
    for _, row in df.iterrows():
        score = int(row["risk_score"])
        rows.append(
            {
                "location_id": re.sub(r"[^a-z0-9]+", "", row["Location Description"].lower()),
                "name": pretty_location_name(row["Location Description"]),
                "type": row["Location Type"],
                "band": row["band"],
                "bandClass": band_class(row["band"]),
                "color": band_color(row["band"]),
                "score": score,
                "predicted_collisions": float(row["predicted_collisions"]),
                "severe_probability": f'{round(float(row["severe_proxy"]) * 100)}%',
                "confidence": f'{float(row["confidence"]):.2f}',
                "coverage": f'{int(row["coverage_months"])} mo',
                "lat": float(row["lat"]),
                "lng": float(row["lng"]),
                "intensity": max(0.45, min(1.0, score / 100)),
                "radiusPx": int(round(55 + score * 0.6)),
                "corridor": str(row["Location Type"]).lower() == "midblock",
                "summaryTitle": "Forecast-generated risk hotspot",
                "summaryBody": "This location is ranked using a LightGBM forecast over historical collisions, severity trends, and vulnerable road user exposure.",
                "explain": [
                    {
                        "label": "12-mo collision history",
                        "value": int(min(100, (float(row["collisions_roll_12"]) / 12.0) * 100)),
                        "color": "#39b6fb",
                        "score": "0.34",
                    },
                    {
                        "label": "Serious injury trend",
                        "value": int(min(100, (float(row["major_injuries_roll_6"]) / 6.0) * 100)),
                        "color": "#f5a623",
                        "score": "0.26",
                    },
                    {
                        "label": "Pedestrian exposure",
                        "value": int(min(100, (float(row["pedestrians_roll_6"]) / 6.0) * 100)),
                        "color": "#0891b2",
                        "score": "0.22",
                    },
                    {
                        "label": "Cyclist exposure",
                        "value": int(min(100, (float(row["cyclists_roll_6"]) / 6.0) * 100)),
                        "color": "#e87d95",
                        "score": "0.18",
                    },
                ],
            }
        )
    return rows


def main() -> None:
    df = load_data(DATA_PATH)
    feature_df = build_monthly_features(df)
    model, feature_cols, feature_df = train_model(feature_df)

    joblib.dump(
        {
            "model": model,
            "feature_cols": feature_cols,
        },
        MODEL_PATH,
    )
    print(f"\nSaved model to {MODEL_PATH}")

    print("raw df columns:", df.columns.tolist())
    print("feature_df columns:", feature_df.columns.tolist())
    preds = build_latest_predictions(model, feature_cols, feature_df)
    preds = attach_coordinates(preds)

    print("\nTop predicted hotspots:")
    print(
        preds[
            [
                "Location Description",
                "Location Type",
                "month",
                "predicted_collisions",
                "risk_score",
                "band",
                "severe_proxy",
                "confidence",
                "lat",
                "lng",
            ]
        ]
        .head(10)
        .to_string(index=False)
    )

    preds.to_csv("latest_predictions.csv", index=False)
    print("\nSaved predictions to latest_predictions.csv")

    mapped_preds = preds.dropna(subset=["lat", "lng"]).copy()
    mapped_preds.to_csv("latest_predictions_mapped.csv", index=False)
    print(f"Saved {len(mapped_preds)} mapped predictions to latest_predictions_mapped.csv")

    frontend_rows = build_frontend_json(mapped_preds)

    import json
    with open("map_predictions.json", "w", encoding="utf-8") as f:
        json.dump(frontend_rows, f, indent=2)

    print(f"Saved {len(frontend_rows)} frontend-ready predictions to map_predictions.json")

    unmapped = preds[preds["lat"].isna() | preds["lng"].isna()]["Location Description"].drop_duplicates().tolist()
    if unmapped:
        print("\nLocations missing coordinates:")
        for loc in unmapped[:50]:
            print(f" - {loc}")


if __name__ == "__main__":
    main()