# server.py
from flask import Flask, jsonify, request, send_from_directory
import os
import uuid # To generate unique IDs for tiles
import json # Import json library
from werkzeug.utils import secure_filename # For secure file handling

app = Flask(__name__)

# Configuration (adjust paths as needed)
# Ensure these directories exist relative to server.py
ASSET_FOLDER = 'assets' # Combined folder for images and audio
IMAGE_FOLDER = os.path.join(ASSET_FOLDER, 'images')
AUDIO_FOLDER = os.path.join(ASSET_FOLDER, 'audio')
TILES_JSON_FILE = 'tiles.json' # File to store tile definitions
ALLOWED_EXTENSIONS_IMG = {'webp'}
ALLOWED_EXTENSIONS_AUDIO = {'mp3', 'ogg'} # Allow both mp3 and ogg
# Create directories if they don't exist
os.makedirs(IMAGE_FOLDER, exist_ok=True)
os.makedirs(AUDIO_FOLDER, exist_ok=True)

# --- Tile Data Storage ---
def load_tiles_from_file():
    """Loads tile definitions from the JSON file."""
    if os.path.exists(TILES_JSON_FILE):
        try:
            with open(TILES_JSON_FILE, 'r') as f:
                data = json.load(f)
                print(f"Loaded {len(data)} tile definitions from {TILES_JSON_FILE}")
                return data
        except (json.JSONDecodeError, IOError) as e:
            print(f"Error loading {TILES_JSON_FILE}: {e}. Starting fresh.")
            return {}
    else:
        print(f"{TILES_JSON_FILE} not found. Starting fresh.")
        return {}

def save_tiles_to_file():
    """Saves the current tile definitions to the JSON file."""
    try:
        with open(TILES_JSON_FILE, 'w') as f:
            json.dump(tile_definitions, f, indent=4) # Use indent for readability
            print(f"Saved {len(tile_definitions)} tile definitions to {TILES_JSON_FILE}")
    except IOError as e:
        print(f"Error saving tiles to {TILES_JSON_FILE}: {e}")

# Load initial data
tile_definitions = load_tiles_from_file()

# --- Helper Functions ---
def allowed_file(filename, allowed_extensions):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in allowed_extensions

# --- API Endpoints ---

@app.route('/')
def serve_index():
    """Serves the main index.html file."""
    # Assumes index.html is in the same directory as server.py
    # For better structure, you might move index.html to a 'static' or 'templates' folder later
    return send_from_directory('.', 'index.html')

@app.route('/script.js')
def serve_js():
    """Serves the main script.js file."""
    return send_from_directory('.', 'script.js')

@app.route('/style.css')
def serve_css():
    """Serves the main style.css file."""
    return send_from_directory('.', 'style.css')

@app.route('/api/tiles', methods=['GET'])
def get_available_tiles():
    """Returns a list of all defined tiles."""
    # Return tile definitions as a list of values
    return jsonify(list(tile_definitions.values()))

@app.route('/api/tiles', methods=['POST'])
def create_tile():
    """Creates a new tile definition and saves uploaded assets."""
    # Check if the post request has the file parts
    if 'tile-image' not in request.files or 'tile-audio' not in request.files:
        return jsonify({"error": "Missing image or audio file part"}), 400

    image_file = request.files['tile-image']
    audio_file = request.files['tile-audio']
    tile_text = request.form.get('tile-text', '')
    next_page = request.form.get('next-page', '')

    # Basic validation
    if tile_text == '':
        return jsonify({"error": "Tile text is required"}), 400
    if image_file.filename == '' or audio_file.filename == '':
        return jsonify({"error": "No selected file for image or audio"}), 400

    # Validate file types and save them
    if image_file and allowed_file(image_file.filename, ALLOWED_EXTENSIONS_IMG):
        image_filename = secure_filename(image_file.filename)
        image_path = os.path.join(IMAGE_FOLDER, image_filename)
        # Avoid overwriting? For now, allow overwrite.
        image_file.save(image_path)
    else:
        return jsonify({"error": "Invalid image file type (must be .webp)"}), 400

    if audio_file and allowed_file(audio_file.filename, ALLOWED_EXTENSIONS_AUDIO):
        audio_filename = secure_filename(audio_file.filename)
        audio_path = os.path.join(AUDIO_FOLDER, audio_filename)
        audio_file.save(audio_path)
    else:
         return jsonify({"error": "Invalid audio file type (must be .mp3 or .ogg)"}), 400

    # Generate unique ID and store definition
    tile_id = str(uuid.uuid4()) # Generate a unique ID
    new_tile = {
        "id": tile_id,
        "text": tile_text,
        "image": image_filename,
        "audio": audio_filename,
        "nextPage": next_page
    }
    tile_definitions[tile_id] = new_tile
    print(f"Created Tile: {new_tile}")
    save_tiles_to_file() # Save after creating

    return jsonify(new_tile), 201 # 201 Created

@app.route('/api/tiles/<string:tile_id>', methods=['DELETE'])
def delete_tile(tile_id):
    """Deletes a tile definition and its associated assets."""
    if tile_id not in tile_definitions:
        return jsonify({"error": "Tile not found"}), 404

    tile_to_delete = tile_definitions[tile_id]

    # Attempt to delete asset files (optional, handle errors gracefully)
    try:
        if tile_to_delete.get('image'):
            os.remove(os.path.join(IMAGE_FOLDER, tile_to_delete['image']))
        if tile_to_delete.get('audio'):
             os.remove(os.path.join(AUDIO_FOLDER, tile_to_delete['audio']))
    except OSError as e:
        print(f"Warning: Could not delete asset file during tile delete: {e}")
        # Don't fail the whole operation if file deletion fails

    # Delete definition
    del tile_definitions[tile_id]
    print(f"Deleted Tile ID: {tile_id}")
    save_tiles_to_file() # Save after deleting

    return jsonify({"message": "Tile deleted"}), 200

# Serve static assets (images/audio)
# Example: /assets/images/hungry.webp
@app.route('/assets/<path:subfolder>/<path:filename>')
def serve_asset(subfolder, filename):
    """Serves files from the assets/images or assets/audio directories."""
    if subfolder == 'images':
        return send_from_directory(IMAGE_FOLDER, filename)
    elif subfolder == 'audio':
        return send_from_directory(AUDIO_FOLDER, filename)
    else:
        return "Invalid asset type", 404

# --- Admin Interface Routes (Placeholders) ---

@app.route('/admin')
def admin_interface():
    """Serves the admin HTML page."""
    return send_from_directory('.', 'admin.html') # Serve the new admin page

# --- TODO: Add endpoints for admin actions ---
# POST /api/tiles (create new tile definition, handle file uploads)
# PUT /api/tiles/<tile_id> (update existing tile)
# DELETE /api/tiles/<tile_id> (delete tile)


# --- Main execution ---

if __name__ == '__main__':
    # Run in debug mode for development (auto-reloads)
    # Accessible on your local network via your machine's IP
    app.run(debug=True, host='0.0.0.0', port=5010) 