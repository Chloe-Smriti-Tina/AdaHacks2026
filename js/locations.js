let RAW_LOCS = [];

async function initLocations(){

    RAW_LOCS = await loadCSV("data/locations.csv");

    // Convert numeric fields
    RAW_LOCS.forEach(loc => {
        loc.collision_count = Number(loc.collision_count);
        loc.fatalities = Number(loc.fatalities);
        loc.serious = Number(loc.serious);
        loc.minor = Number(loc.minor);
        loc.pedestrian_involved = Number(loc.pedestrian_involved);
        loc.bicycle_involved = Number(loc.bicycle_involved);
        loc.community_complaints = Number(loc.community_complaints);
    });

    renderList();
    buildWeightsGrid();
}

document.addEventListener("DOMContentLoaded", initLocations);
