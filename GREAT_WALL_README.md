# Fugu Great Wall Guardian

Open `great-wall.html` from **Great Wall** in the homepage navigation. The original `academic.html` is unchanged. The project follows the portfolio's navy and orange theme and supports desktop and mobile layouts.

## Local preview and checks

Serve the directory over HTTP rather than opening the HTML file directly:

```powershell
python -m http.server 5178 --bind 127.0.0.1
# http://127.0.0.1:5178/great-wall.html
npm run check
npm test
```

No npm runtime dependencies were added. Leaflet 1.9.4 is included locally; its license is in `assets/vendor/leaflet/LICENSE`. The OpenStreetMap basemap retains its attribution. Geographic labels in third-party map tiles follow the provider's source data.

## Tools and records

- **Footprint map:** ten original project sites, browser location, volunteer visits, and warden patrols. Coordinates are demonstration values, clearly labelled, and are not for field navigation.
- **Site journal:** site stories, preservation advice, and observations. Entries without an on-site location are remote observations and do not count as visits.
- **AI studio:** the original `gpt-image-2` model, five keepsake types, and up to four reference photos. Async tasks can be resumed after refreshing. Stopping the wait does not cancel the server task.
- **Community:** the existing gateway's public gallery. Images and notes are published only after explicit confirmation. Empty and failed states reflect the real response.
- **My records:** images are IndexedDB Blobs, recoverable after refreshing, with downloads, JSON export, and local deletion. The archive keeps the latest 60 records and 30 designs. Clearing site data removes it; download anything important.
- **Needs attention:** the original educational reference scoring, updated with local and shared records. Scores are not professional assessments of heritage condition or safety.

The interface, built-in site content, system messages, dates, and generation prompts are in English. Image lettering is explicitly requested in English. Legacy archive labels are normalized on read without changing record IDs, image Blobs, task IDs, or personal notes. Existing images and user-authored content are preserved. Reference text-length values keep the scoring unchanged by translation.

Patrol and visit sync sends activity metadata only: record ID, site, role, time, location range, and whether a photo exists. It does not upload images or observation notes. Stories stay local. Local deletion does not remove synced statistics or public gallery entries.

The sites, stories, and reference scores came from `E:\WeChatProjects\changcheng`, which remains unchanged. Cover photographs are stored in `assets/great-wall/` and retain the original public-source links in each site's details.

## AI service and publishing

The browser calls `https://47.103.59.118/ai` for reference uploads, generation tasks, status checks, gallery entries, and activity metadata. Upstream credentials remain on the server; there is no API key in the frontend.

The existing IP TLS site proxies `/ai/` and permits these browser origins:

- `https://mingrenzheng2007.github.io`
- `http://127.0.0.1:5178`
- `http://localhost:5178`

HTTPS image submission is limited per IP to one request a minute, with one burst request. This reduces repeat submissions; it is not user authentication. Other endpoints retain the gateway's existing behavior.

Local Nginx configuration and the deployment script are under `E:\WeChatProjects\shared-ai-gateway\deploy\allen-ai-*` and `install-allen-ai.py`. The original server configuration backup is `/opt/shared-ai-gateway/.deploy-backups/allen-https-20261003-012234`. The HTTPS integration did not change the server `.env` or model-service source.

Published page: `https://mingrenzheng2007.github.io/great-wall.html`. GitHub Pages publishes the homepage repository. Mockups, screenshots, test browser data, and AI verification images in `tmp/` are excluded from source commits.
