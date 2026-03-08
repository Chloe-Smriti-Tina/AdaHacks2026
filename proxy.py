"""
Groq proxy for CityScope — reads API key from .env, forwards to Groq.

Setup:
    pip install flask flask-cors python-dotenv groq
    python proxy.py

Keep this running alongside Live Server.
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from groq import Groq
import os

load_dotenv()

app = Flask(__name__)
CORS(app)

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

@app.route("/gemini", methods=["POST"])
def gemini():
    data = request.get_json()
    # Extract the prompt text from the Gemini-style request body
    prompt = data["contents"][0]["parts"][0]["text"]

    completion = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_completion_tokens=1024,
        response_format={"type": "json_object"}
    )

    text = completion.choices[0].message.content
    # Return in Gemini-style format so the frontend doesn't need changes
    return jsonify({
        "candidates": [{"content": {"parts": [{"text": text}]}}]
    })

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3131))
    print(f"Proxy running on port {port}")
    app.run(host="0.0.0.0", port=port)