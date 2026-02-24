# RNG Scoring App

A Progressive Web App (PWA) for tracking scores with offline capability.

## Features

- ✅ Works on any device (iOS, Android, Desktop)
- ✅ Offline data storage using IndexedDB
- ✅ Auto-sync when internet connection is available
- ✅ Can be installed like a native app
- ✅ Responsive design for all screen sizes

## How to Use

### For Development (Local Testing)

1. Install a local web server. Using Python:
   ```bash
   python -m http.server 8000
   ```
   Or using Node.js:
   ```bash
   npx http-server
   ```

2. Open browser and go to `http://localhost:8000`

3. The app will work offline after first load

### For Production Deployment

1. Upload all files to any web hosting service (Netlify, Vercel, GitHub Pages, etc.)
2. Share the URL with users
3. Users can "install" the app from their browser menu

### Installing on Mobile

**iPhone/iPad:**
- Open in Safari
- Tap the Share button
- Tap "Add to Home Screen"

**Android:**
- Open in Chrome
- Tap the menu (three dots)
- Tap "Add to Home Screen"

## Backend API Setup (Optional)

To enable syncing, you need a backend API endpoint. Create a simple API that:

1. Accepts POST requests to `/api/scores`
2. Stores the scores in a database
3. Returns a success response

Example using Python Flask:

```python
from flask import Flask, request, jsonify
from flask_cors import CORS
import json

app = Flask(__name__)
CORS(app)

@app.route('/api/scores', methods=['POST'])
def save_scores():
    scores = request.json
    # Save to your database here
    print(f"Received {len(scores)} scores")
    return jsonify({"status": "success", "count": len(scores)})

if __name__ == '__main__':
    app.run(port=5000)
```

Update the API endpoint in `app.js` (line 91):
```javascript
const response = await fetch('https://your-api-endpoint.com/api/scores', {
```

## Customization

- Edit `index.html` to change the form fields
- Edit `styles.css` to change colors and layout
- Edit `app.js` to modify functionality
- Update `manifest.json` to change app name and colors

## Icons

You'll need to create two icon files:
- `icon-192.png` (192x192 pixels)
- `icon-512.png` (512x512 pixels)

Use any icon generator or create them manually.

## Files Structure

```
RNG Scoring App/
├── index.html          # Main HTML file
├── styles.css          # Styling
├── app.js             # Main application logic
├── service-worker.js  # Enables offline functionality
├── manifest.json      # PWA configuration
└── README.md          # This file
```

## Browser Support

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support (iOS 11.3+)
- Opera: Full support
