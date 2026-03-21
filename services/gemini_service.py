import os
import json
import google.generativeai as genai
from typing import Optional, Dict, Any

def extract_vehicle_details(image_base64: str) -> Dict[str, str]:
    """
    Analyzes an image and extracts:
    1. License plate number
    2. Vehicle type (Light, Medium, Heavy)
    
    Returns: A dictionary with 'plate' and 'vehicle_type'.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable is not set")

    genai.configure(api_key=api_key)
    # Downgraded to gemini-1.5-flash to avoid Google Cloud Billing requirement
    model = genai.GenerativeModel("gemini-1.5-flash")

    prompt = """
    Analyze this image and extract:
    1. Vehicle license plate number
    2. Vehicle type categorized strictly as one of: Light, Medium, Heavy

    Definitions:
    * Light: Bike, scooter, car, jeep
    * Medium: Van, pickup, auto-rickshaw, mini bus
    * Heavy: Truck, bus, lorry

    Return ONLY valid JSON in this format:
    {
      "plate": "...",
      "vehicle_type": "Light/Medium/Heavy"
    }

    If plate is not visible:
    {
      "plate": "No license plate detected",
      "vehicle_type": "Unknown"
    }
    """

    contents = [
        prompt,
        {"mime_type": "image/jpeg", "data": image_base64}
    ]

    try:
        response = model.generate_content(contents)
        text_response = response.text.strip()
        
        # Clean potential markdown code blocks from response
        if "```json" in text_response:
            text_response = text_response.split("```json")[1].split("```")[0].strip()
        elif "```" in text_response:
            text_response = text_response.split("```")[1].split("```")[0].strip()

        try:
            data = json.loads(text_response)
        except json.JSONDecodeError:
            # Fallback parsing if JSON is slightly malformed
            print(f"Failed to parse Gemini JSON: {text_response}")
            return {"plate": "Error", "vehicle_type": "Light"}

        # Normalize vehicle type
        v_type = data.get("vehicle_type", "Light").capitalize()
        if v_type not in ["Light", "Medium", "Heavy"]:
            v_type = "Light"

        return {
            "plate": data.get("plate", "No license plate detected"),
            "vehicle_type": v_type
        }

    except Exception as e:
        print(f"Gemini API Error: {str(e)}")
        return {"plate": "Detection Error", "vehicle_type": "Light"}

def extract_plate_from_image(image_base64: str) -> Optional[str]:
    """Deprecated: Use extract_vehicle_details instead."""
    details = extract_vehicle_details(image_base64)
    return details["plate"]
