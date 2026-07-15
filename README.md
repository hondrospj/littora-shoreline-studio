# Littora — Shoreline Studio

Littora is a browser-based shoreline digitizing workspace. It reads GeoTIFF georeferencing directly in the browser, aligns imagery over a choice of basemaps, supports editable multi-vertex linework, and exports all shorelines as KMZ or a zipped ESRI Shapefile bundle.

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

The static site is written to `dist/`. The included GitHub Actions workflow deploys that directory to GitHub Pages whenever `main` is updated.

## GeoTIFF support

- WGS 84 (`EPSG:4326`)
- Web Mercator (`EPSG:3857`)
- WGS 84 UTM north and south zones (`EPSG:326xx` / `EPSG:327xx`)
- Filename bounds fallback using `[west,south,east,north]`

All image processing and export generation stays on the device; files are not uploaded to a server.
