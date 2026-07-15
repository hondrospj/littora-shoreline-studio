"use client";

import {
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  FileArchive,
  Focus,
  ImagePlus,
  Layers3,
  Map as MapIcon,
  MapPinned,
  Menu,
  Plus,
  Route,
  Satellite,
  Sparkles,
  SquarePen,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type LngLat = [number, number];

type LineFeature = {
  id: string;
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: {
    type: "LineString";
    coordinates: LngLat[];
  };
};

type ImageryInfo = {
  name: string;
  width: number;
  height: number;
  epsg: number | null;
  coordinates: [LngLat, LngLat, LngLat, LngLat];
  center: LngLat;
  placement: "Embedded georeference" | "Filename bounds";
};

type Notice = { tone: "success" | "error" | "info"; text: string } | null;
type BasemapId = "satellite" | "streets" | "dark" | "topographic";

const BASEMAPS: Array<{
  id: BasemapId;
  label: string;
  icon: typeof Satellite;
}> = [
  { id: "satellite", label: "Satellite", icon: Satellite },
  { id: "streets", label: "Streets", icon: MapIcon },
  { id: "dark", label: "Dark", icon: Layers3 },
  { id: "topographic", label: "Topo", icon: MapPinned },
];

const INITIAL_CENTER: LngLat = [-74.7774, 39.0095];

const BASE_STYLE = {
  version: 8,
  sources: {
    satellite: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution:
        "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
    streets: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors",
    },
    dark: {
      type: "raster",
      tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    },
    topographic: {
      type: "raster",
      tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap",
    },
  },
  layers: BASEMAPS.map((basemap) => ({
    id: `base-${basemap.id}`,
    type: "raster",
    source: basemap.id,
    layout: { visibility: basemap.id === "satellite" ? "visible" : "none" },
  })),
};

const DRAW_STYLES = [
  {
    id: "gl-draw-line-inactive",
    type: "line",
    filter: ["all", ["==", "$type", "LineString"], ["!=", "active", "true"]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#dcff45",
      "line-width": 4,
      "line-opacity": 0.96,
    },
  },
  {
    id: "gl-draw-line-active",
    type: "line",
    filter: ["all", ["==", "$type", "LineString"], ["==", "active", "true"]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffffff",
      "line-width": 4,
      "line-dasharray": [1.2, 1.2],
    },
  },
  {
    id: "gl-draw-line-vertex-halo-active",
    type: "circle",
    filter: [
      "all",
      ["==", "meta", "vertex"],
      ["==", "$type", "Point"],
      ["!=", "mode", "static"],
    ],
    paint: { "circle-radius": 7, "circle-color": "#11150d" },
  },
  {
    id: "gl-draw-line-vertex-active",
    type: "circle",
    filter: [
      "all",
      ["==", "meta", "vertex"],
      ["==", "$type", "Point"],
      ["!=", "mode", "static"],
    ],
    paint: {
      "circle-radius": 4.5,
      "circle-color": "#dcff45",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1,
    },
  },
  {
    id: "gl-draw-midpoint",
    type: "circle",
    filter: ["all", ["==", "meta", "midpoint"], ["==", "$type", "Point"]],
    paint: { "circle-radius": 3.5, "circle-color": "#ffffff" },
  },
];

function haversineMeters(coordinates: LngLat[]) {
  let total = 0;
  const radius = 6371008.8;
  for (let index = 1; index < coordinates.length; index += 1) {
    const [lng1, lat1] = coordinates[index - 1];
    const [lng2, lat2] = coordinates[index];
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    total += radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return total;
}

function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.round(meters).toLocaleString()} m`;
  return `${(meters / 1000).toFixed(meters > 10000 ? 1 : 2)} km`;
}

function mercatorToLngLat(x: number, y: number): LngLat {
  const lng = (x / 20037508.342789244) * 180;
  const latRadians = 2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2;
  return [lng, (latRadians * 180) / Math.PI];
}

function boundsFromFilename(name: string): [number, number, number, number] | null {
  const match = name.match(
    /\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/,
  );
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
}

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function getCoordinateConverter(epsg: number | null) {
  if (epsg === 4326) return (point: LngLat) => point;
  if (epsg === 3857 || epsg === 900913) {
    return (point: LngLat) => mercatorToLngLat(point[0], point[1]);
  }
  if (epsg && ((epsg >= 32601 && epsg <= 32660) || (epsg >= 32701 && epsg <= 32760))) {
    const zone = epsg % 100;
    const south = epsg >= 32700;
    return async (point: LngLat): Promise<LngLat> => {
      const { default: proj4 } = await import("proj4");
      const source = `+proj=utm +zone=${zone} ${south ? "+south " : ""}+datum=WGS84 +units=m +no_defs`;
      return proj4(source, "EPSG:4326", point) as LngLat;
    };
  }
  return null;
}

async function renderGeoTiff(file: File) {
  const { fromBlob } = await import("geotiff");
  const tiff = await fromBlob(file);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const geoKeys = image.getGeoKeys() as Record<string, unknown>;
  let epsg = Number(geoKeys.ProjectedCSTypeGeoKey ?? geoKeys.GeographicTypeGeoKey) || null;
  let placement: ImageryInfo["placement"] = "Embedded georeference";
  let rawBounds: [number, number, number, number] | null = null;

  try {
    const bounds = image.getBoundingBox();
    if (bounds.every(Number.isFinite) && bounds[0] !== bounds[2] && bounds[1] !== bounds[3]) {
      rawBounds = bounds as [number, number, number, number];
    }
  } catch {
    rawBounds = null;
  }

  let converted: [LngLat, LngLat, LngLat, LngLat];
  if (rawBounds) {
    if (!epsg) {
      const allLookGeographic =
        Math.abs(rawBounds[0]) <= 180 &&
        Math.abs(rawBounds[2]) <= 180 &&
        Math.abs(rawBounds[1]) <= 90 &&
        Math.abs(rawBounds[3]) <= 90;
      if (allLookGeographic) epsg = 4326;
      else if (Math.max(...rawBounds.map(Math.abs)) <= 20050000) epsg = 3857;
    }
    const converter = getCoordinateConverter(epsg);
    if (!converter) {
      throw new Error(
        `This GeoTIFF uses ${epsg ? `EPSG:${epsg}` : "an unidentified projection"}. Use WGS 84, Web Mercator, or WGS 84 UTM imagery.`,
      );
    }
    const [minX, minY, maxX, maxY] = rawBounds;
    converted = [
      await converter([minX, maxY]),
      await converter([maxX, maxY]),
      await converter([maxX, minY]),
      await converter([minX, minY]),
    ];
  } else {
    const filenameBounds = boundsFromFilename(file.name);
    if (!filenameBounds) {
      throw new Error("No embedded georeference or [west,south,east,north] filename bounds were found.");
    }
    const [west, south, east, north] = filenameBounds;
    epsg = 4326;
    placement = "Filename bounds";
    converted = [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ];
  }

  const maxSide = 4096;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const renderWidth = Math.max(1, Math.round(width * scale));
  const renderHeight = Math.max(1, Math.round(height * scale));
  const samples = image.getSamplesPerPixel();
  const raster = (await image.readRasters({
    interleave: true,
    width: renderWidth,
    height: renderHeight,
    resampleMethod: "bilinear",
  })) as unknown as ArrayLike<number>;
  const bits = (image.getFileDirectory() as unknown as { BitsPerSample?: number[] }).BitsPerSample ?? [8];
  const bitDepth = Array.isArray(bits) ? Math.max(...bits) : Number(bits);
  const sampleMax = bitDepth > 8 ? 2 ** Math.min(bitDepth, 24) - 1 : 255;
  const canvas = document.createElement("canvas");
  canvas.width = renderWidth;
  canvas.height = renderHeight;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Your browser could not prepare the image canvas.");
  const output = context.createImageData(renderWidth, renderHeight);
  const normalize = (value: number) =>
    Math.max(0, Math.min(255, bitDepth > 8 ? (value / sampleMax) * 255 : value));

  for (let pixel = 0; pixel < renderWidth * renderHeight; pixel += 1) {
    const sourceIndex = pixel * samples;
    const targetIndex = pixel * 4;
    const red = raster[sourceIndex] ?? 0;
    const green = samples >= 3 ? raster[sourceIndex + 1] : red;
    const blue = samples >= 3 ? raster[sourceIndex + 2] : red;
    const alpha = samples === 2 ? raster[sourceIndex + 1] : samples >= 4 ? raster[sourceIndex + 3] : sampleMax;
    output.data[targetIndex] = normalize(red);
    output.data[targetIndex + 1] = normalize(green);
    output.data[targetIndex + 2] = normalize(blue);
    output.data[targetIndex + 3] = normalize(alpha);
  }
  context.putImageData(output, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Image conversion failed."))), "image/png");
  });
  const west = Math.min(...converted.map((coordinate) => coordinate[0]));
  const east = Math.max(...converted.map((coordinate) => coordinate[0]));
  const south = Math.min(...converted.map((coordinate) => coordinate[1]));
  const north = Math.max(...converted.map((coordinate) => coordinate[1]));

  return {
    blob,
    info: {
      name: file.name,
      width,
      height,
      epsg,
      coordinates: converted,
      center: [(west + east) / 2, (south + north) / 2] as LngLat,
      placement,
    } satisfies ImageryInfo,
    bounds: [
      [west, south],
      [east, north],
    ] as [LngLat, LngLat],
  };
}

export default function Home() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<any>(null);
  const drawRef = useRef<any>(null);
  const imageryUrlRef = useRef<string | null>(null);
  const lineCounterRef = useRef(1);
  const [mapReady, setMapReady] = useState(false);
  const [basemap, setBasemap] = useState<BasemapId>("satellite");
  const [lines, setLines] = useState<LineFeature[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [imagery, setImagery] = useState<ImageryInfo | null>(null);
  const [imageryVisible, setImageryVisible] = useState(true);
  const [imageryOpacity, setImageryOpacity] = useState(0.78);
  const [loadingImagery, setLoadingImagery] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [pointer, setPointer] = useState<LngLat>(INITIAL_CENTER);
  const [zoom, setZoom] = useState(13);
  const [mobilePanel, setMobilePanel] = useState<"imagery" | "lines" | null>(null);

  const syncLines = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;
    const next = draw
      .getAll()
      .features.filter((feature: any) => feature.geometry?.type === "LineString")
      .map((feature: any) => ({
        ...feature,
        id: String(feature.id),
        properties: feature.properties ?? {},
      })) as LineFeature[];
    setLines(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pointerFrame = 0;
    const initializeMap = async () => {
      if (!mapContainerRef.current || mapRef.current) return;
      const maplibre = await import("maplibre-gl");
      const { default: MapboxDraw } = await import("@mapbox/mapbox-gl-draw");
      if (cancelled || !mapContainerRef.current) return;

      const drawClasses = (MapboxDraw as any).constants?.classes;
      if (drawClasses) {
        drawClasses.CANVAS = "maplibregl-canvas";
        drawClasses.CONTROL_BASE = "maplibregl-ctrl";
        drawClasses.CONTROL_PREFIX = "maplibregl-ctrl-";
        drawClasses.CONTROL_GROUP = "maplibregl-ctrl-group";
        drawClasses.ATTRIBUTION = "maplibregl-ctrl-attrib";
      }

      const map = new maplibre.Map({
        container: mapContainerRef.current,
        style: BASE_STYLE as any,
        center: INITIAL_CENTER,
        zoom: 13,
        minZoom: 2,
        maxZoom: 22,
        attributionControl: {},
      });
      const markMapReady = () => {
        if (!cancelled) setMapReady(true);
      };
      map.once("style.load", markMapReady);
      map.once("load", markMapReady);
      const draw = new (MapboxDraw as any)({
        displayControlsDefault: false,
        keybindings: true,
        touchEnabled: true,
        styles: DRAW_STYLES,
      });
      map.addControl(draw);
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
      mapRef.current = map;
      drawRef.current = draw;

      if (map.isStyleLoaded() || map.loaded()) markMapReady();

      const handleCreate = (event: any) => {
        for (const feature of event.features ?? []) {
          const name = `Shoreline ${String(lineCounterRef.current).padStart(2, "0")}`;
          lineCounterRef.current += 1;
          if (feature.id != null) draw.setFeatureProperty(feature.id, "name", name);
        }
        syncLines();
        setNotice({ tone: "success", text: "Shoreline saved to the working layer." });
      };
      const handleSelection = () => {
        const ids = draw.getSelectedIds();
        setSelectedId(ids.length ? String(ids[0]) : null);
      };
      const handleMode = (event: any) => setIsDrawing(event.mode === "draw_line_string");
      const handleMouseMove = (event: any) => {
        if (pointerFrame) return;
        pointerFrame = window.requestAnimationFrame(() => {
          setPointer([event.lngLat.lng, event.lngLat.lat]);
          pointerFrame = 0;
        });
      };
      const handleZoom = () => setZoom(map.getZoom());

      map.on("draw.create", handleCreate);
      map.on("draw.update", syncLines);
      map.on("draw.delete", syncLines);
      map.on("draw.selectionchange", handleSelection);
      map.on("draw.modechange", handleMode);
      map.on("mousemove", handleMouseMove);
      map.on("zoomend", handleZoom);
    };
    initializeMap();
    return () => {
      cancelled = true;
      if (pointerFrame) window.cancelAnimationFrame(pointerFrame);
      if (imageryUrlRef.current) URL.revokeObjectURL(imageryUrlRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
  }, [syncLines]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const switchBasemap = (id: BasemapId) => {
    const map = mapRef.current;
    if (!map) return;
    for (const option of BASEMAPS) {
      if (map.getLayer(`base-${option.id}`)) {
        map.setLayoutProperty(`base-${option.id}`, "visibility", option.id === id ? "visible" : "none");
      }
    }
    setBasemap(id);
  };

  const addImageryToMap = useCallback(
    async (file: File) => {
      if (!mapReady || !mapRef.current) {
        setNotice({ tone: "info", text: "The map is still getting ready. Try again in a moment." });
        return;
      }
      if (!/\.tiff?$/i.test(file.name) && !file.type.includes("tiff")) {
        setNotice({ tone: "error", text: "Choose a .tif or .tiff GeoTIFF file." });
        return;
      }
      setLoadingImagery(true);
      setMobilePanel("imagery");
      try {
        const rendered = await renderGeoTiff(file);
        const map = mapRef.current;
        if (map.getLayer("uploaded-geotiff-layer")) map.removeLayer("uploaded-geotiff-layer");
        if (map.getSource("uploaded-geotiff")) map.removeSource("uploaded-geotiff");
        if (imageryUrlRef.current) URL.revokeObjectURL(imageryUrlRef.current);
        const imageUrl = URL.createObjectURL(rendered.blob);
        imageryUrlRef.current = imageUrl;
        map.addSource("uploaded-geotiff", {
          type: "image",
          url: imageUrl,
          coordinates: rendered.info.coordinates,
        });
        const firstDrawLayer = map
          .getStyle()
          .layers?.find((layer: any) => String(layer.id).startsWith("gl-draw"))?.id;
        map.addLayer(
          {
            id: "uploaded-geotiff-layer",
            type: "raster",
            source: "uploaded-geotiff",
            paint: { "raster-opacity": imageryOpacity, "raster-fade-duration": 0 },
          },
          firstDrawLayer,
        );
        const compactViewport = window.matchMedia("(max-width: 900px)").matches;
        map.fitBounds(rendered.bounds, {
          padding: compactViewport
            ? { top: 82, right: 24, bottom: 78, left: 24 }
            : { top: 104, right: 390, bottom: 96, left: 350 },
          duration: 900,
          maxZoom: 17,
        });
        setImagery(rendered.info);
        setImageryVisible(true);
        setNotice({ tone: "success", text: "GeoTIFF recognized and aligned to its map coordinates." });
      } catch (error) {
        setNotice({
          tone: "error",
          text: error instanceof Error ? error.message : "The GeoTIFF could not be opened.",
        });
      } finally {
        setLoadingImagery(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [imageryOpacity, mapReady],
  );

  const loadDemo = async () => {
    setLoadingImagery(true);
    try {
      const response = await fetch("./demo-cape-may-shoreline.tiff");
      if (!response.ok) throw new Error("The demo tile could not be loaded.");
      const blob = await response.blob();
      const file = new File(
        [blob],
        "S2B_Cape_May_20260713_EPSG3857.tiff",
        { type: "image/tiff" },
      );
      await addImageryToMap(file);
    } catch (error) {
      setLoadingImagery(false);
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Demo load failed." });
    }
  };

  const removeImagery = () => {
    const map = mapRef.current;
    if (map?.getLayer("uploaded-geotiff-layer")) map.removeLayer("uploaded-geotiff-layer");
    if (map?.getSource("uploaded-geotiff")) map.removeSource("uploaded-geotiff");
    if (imageryUrlRef.current) URL.revokeObjectURL(imageryUrlRef.current);
    imageryUrlRef.current = null;
    setImagery(null);
    setNotice({ tone: "info", text: "GeoTIFF removed. Your shoreline lines are unchanged." });
  };

  const toggleImagery = () => {
    const next = !imageryVisible;
    if (mapRef.current?.getLayer("uploaded-geotiff-layer")) {
      mapRef.current.setLayoutProperty("uploaded-geotiff-layer", "visibility", next ? "visible" : "none");
    }
    setImageryVisible(next);
  };

  const updateOpacity = (value: number) => {
    setImageryOpacity(value);
    if (mapRef.current?.getLayer("uploaded-geotiff-layer")) {
      mapRef.current.setPaintProperty("uploaded-geotiff-layer", "raster-opacity", value);
    }
  };

  const startDrawing = () => {
    if (!drawRef.current) return;
    drawRef.current.changeMode("draw_line_string");
    setIsDrawing(true);
    setMobilePanel(null);
    setNotice({ tone: "info", text: "Drawing started." });
  };

  const finishDrawing = () => {
    drawRef.current?.changeMode("simple_select");
    setIsDrawing(false);
  };

  const selectLine = (id: string) => {
    const draw = drawRef.current;
    if (!draw) return;
    try {
      draw.changeMode("direct_select", { featureId: id });
      setSelectedId(id);
      setMobilePanel(null);
    } catch {
      draw.changeMode("simple_select", { featureIds: [id] });
    }
  };

  const deleteSelection = () => {
    if (!drawRef.current || !selectedId) return;
    drawRef.current.delete(selectedId);
    setSelectedId(null);
    syncLines();
  };

  const removeLastVertex = () => {
    const draw = drawRef.current;
    if (!draw || !selectedId) return;
    const feature = draw
      .getAll()
      .features.find((candidate: any) => String(candidate.id) === selectedId);
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length <= 2) {
      setNotice({ tone: "error", text: "A shoreline needs at least two vertices." });
      return;
    }
    draw.add({
      ...feature,
      geometry: { ...feature.geometry, coordinates: coordinates.slice(0, -1) },
    });
    draw.changeMode("direct_select", { featureId: selectedId });
    syncLines();
    setNotice({ tone: "info", text: "Last vertex removed from the selected shoreline." });
  };

  const clearLines = () => {
    if (!drawRef.current || !lines.length) return;
    drawRef.current.deleteAll();
    setSelectedId(null);
    syncLines();
    setNotice({ tone: "info", text: "All working shorelines cleared." });
  };

  const lineFeatureCollection = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: lines.map((line, index) => ({
        ...line,
        properties: {
          name: String(line.properties.name ?? `Shoreline ${String(index + 1).padStart(2, "0")}`),
          vertices: line.geometry.coordinates.length,
          length_m: Math.round(haversineMeters(line.geometry.coordinates)),
        },
      })),
    }),
    [lines],
  );

  const exportKmz = async () => {
    if (!lines.length) return;
    const placemarks = lineFeatureCollection.features
      .map(
        (feature) => `
    <Placemark>
      <name>${xmlEscape(feature.properties.name)}</name>
      <ExtendedData>
        <Data name="vertices"><value>${feature.properties.vertices}</value></Data>
        <Data name="length_m"><value>${feature.properties.length_m}</value></Data>
      </ExtendedData>
      <Style><LineStyle><color>ff45ffdc</color><width>3</width></LineStyle></Style>
      <LineString><tessellate>1</tessellate><coordinates>${feature.geometry.coordinates
        .map(([lng, lat]) => `${lng.toFixed(8)},${lat.toFixed(8)},0`)
        .join(" ")}</coordinates></LineString>
    </Placemark>`,
      )
      .join("");
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document><name>Littora shorelines</name>${placemarks}
  </Document>
</kml>`;
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    zip.file("doc.kml", kml);
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    downloadBlob(blob, "littora-shorelines.kmz");
    setNotice({ tone: "success", text: "KMZ prepared with all shoreline lines." });
  };

  const exportShapefile = async () => {
    if (!lines.length) return;
    try {
      const shp = await import("@mapbox/shp-write");
      const blob = await shp.zip<"blob">(lineFeatureCollection as any, {
        folder: "littora-shorelines",
        types: { polyline: "shorelines" },
        outputType: "blob",
        compression: "DEFLATE",
      } as any);
      downloadBlob(blob, "littora-shorelines-shp.zip");
      setNotice({ tone: "success", text: "Shapefile bundle prepared in WGS 84." });
    } catch {
      setNotice({ tone: "error", text: "The shapefile bundle could not be created." });
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) addImageryToMap(file);
  };

  const totalLength = lines.reduce((sum, line) => sum + haversineMeters(line.geometry.coordinates), 0);

  return (
    <main
      className={`workspace ${dragActive ? "is-dragging" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (!nextTarget || !event.currentTarget.contains(nextTarget)) setDragActive(false);
      }}
      onDrop={handleDrop}
    >
      <div ref={mapContainerRef} className="map-canvas" aria-label="Interactive shoreline mapping canvas" />
      <div className="map-vignette" aria-hidden="true" />

      <header className="topbar">
        <div className="brand" aria-label="Littora shoreline studio">
          <span className="brand-mark"><Route size={18} strokeWidth={2.6} /></span>
          <span className="brand-word">Littora</span>
          <span className="brand-tag">Shoreline studio</span>
        </div>

        <nav className="basemap-switcher" aria-label="Choose basemap">
          {BASEMAPS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                className={basemap === option.id ? "active" : ""}
                onClick={() => switchBasemap(option.id)}
                aria-pressed={basemap === option.id}
              >
                <Icon size={15} />
                <span>{option.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="header-actions">
          <label className="mobile-basemap-control">
            <span className="visually-hidden">Choose basemap</span>
            <select value={basemap} onChange={(event) => switchBasemap(event.target.value as BasemapId)}>
              {BASEMAPS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
          <span className={`map-status ${mapReady ? "ready" : ""}`}>
            <i /> {mapReady ? "Map ready" : "Starting map"}
          </span>
          <button
            type="button"
            className="mobile-panel-button"
            onClick={() => setMobilePanel(mobilePanel === "imagery" ? null : "imagery")}
            aria-label="Open imagery panel"
          >
            <ImagePlus size={18} />
          </button>
          <button
            type="button"
            className="mobile-panel-button"
            onClick={() => setMobilePanel(mobilePanel === "lines" ? null : "lines")}
            aria-label="Open shoreline panel"
          >
            <Menu size={19} />
          </button>
        </div>
      </header>

      <aside className={`panel imagery-panel ${mobilePanel === "imagery" ? "mobile-open" : ""}`}>
        <div className="panel-heading">
          <h1>Imagery</h1>
          <button className="panel-close" type="button" onClick={() => setMobilePanel(null)} aria-label="Close panel">
            <X size={18} />
          </button>
        </div>

        {!imagery ? (
          <>
            <button
              type="button"
              className="upload-zone"
              onClick={() => fileInputRef.current?.click()}
              disabled={loadingImagery || !mapReady}
            >
              <span className="upload-icon"><Upload size={21} /></span>
              <strong>{loadingImagery ? "Reading GeoTIFF…" : "Upload GeoTIFF"}</strong>
            </button>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept=".tif,.tiff,image/tiff"
              aria-label="Choose GeoTIFF file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) addImageryToMap(file);
              }}
            />
            <button className="demo-button" type="button" onClick={loadDemo} disabled={loadingImagery || !mapReady}>
              <Sparkles size={15} />
              Cape May sample
              <span>↗</span>
            </button>
          </>
        ) : (
          <section className="imagery-card" aria-label="Loaded GeoTIFF details">
            <div className="aligned-row">
              <span className="aligned-badge"><i /> Aligned</span>
              <div className="icon-actions">
                <button type="button" onClick={toggleImagery} aria-label={imageryVisible ? "Hide GeoTIFF" : "Show GeoTIFF"}>
                  {imageryVisible ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>
                <button type="button" onClick={removeImagery} aria-label="Remove GeoTIFF"><Trash2 size={16} /></button>
              </div>
            </div>
            <strong className="file-name" title={imagery.name}>{imagery.name}</strong>
            <dl className="metadata-grid">
              <div><dt>CRS</dt><dd>{imagery.epsg ? `EPSG:${imagery.epsg}` : "Detected"}</dd></div>
              <div><dt>Pixels</dt><dd>{imagery.width} × {imagery.height}</dd></div>
            </dl>
            <label className="opacity-control">
              <span>Image opacity <b>{Math.round(imageryOpacity * 100)}%</b></span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={imageryOpacity}
                onChange={(event) => updateOpacity(Number(event.target.value))}
              />
            </label>
            <button className="replace-button" type="button" onClick={() => fileInputRef.current?.click()}>
              <Upload size={14} /> Replace imagery
            </button>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept=".tif,.tiff,image/tiff"
              aria-label="Choose replacement GeoTIFF file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) addImageryToMap(file);
              }}
            />
          </section>
        )}

      </aside>

      <aside className={`panel lines-panel ${mobilePanel === "lines" ? "mobile-open" : ""}`}>
        <div className="panel-heading compact">
          <h2>Shorelines</h2>
          <button className="panel-close" type="button" onClick={() => setMobilePanel(null)} aria-label="Close panel">
            <X size={18} />
          </button>
        </div>

        {isDrawing ? (
          <button type="button" className="draw-button finish" onClick={finishDrawing}>
            <Focus size={18} /> Finish line
          </button>
        ) : (
          <button type="button" className="draw-button" onClick={startDrawing} disabled={!mapReady}>
            <Plus size={18} /> New shoreline
          </button>
        )}

        <div className="line-list-heading">
          <span>Working layer</span>
          <span>{lines.length} {lines.length === 1 ? "line" : "lines"}</span>
        </div>

        <div className={`line-list ${lines.length ? "has-lines" : ""}`}>
          {lines.length ? (
            lines.map((line, index) => {
              const name = String(line.properties.name ?? `Shoreline ${String(index + 1).padStart(2, "0")}`);
              const selected = line.id === selectedId;
              return (
                <button
                  type="button"
                  className={`line-item ${selected ? "selected" : ""}`}
                  key={line.id}
                  onClick={() => selectLine(line.id)}
                  aria-pressed={selected}
                >
                  <span className="line-swatch" />
                  <span className="line-copy">
                    <strong>{name}</strong>
                    <small>{line.geometry.coordinates.length} vertices · {formatDistance(haversineMeters(line.geometry.coordinates))}</small>
                  </span>
                  <ChevronDown size={15} className="line-chevron" />
                </button>
              );
            })
          ) : (
            <div className="empty-lines">
              <SquarePen size={22} />
              <strong>No shorelines</strong>
            </div>
          )}
        </div>

        {selectedId && (
          <div className="selection-actions">
            <span>Vertex edit mode</span>
            <div>
              <button type="button" onClick={removeLastVertex}>↶ Remove last vertex</button>
              <button type="button" onClick={deleteSelection}><Trash2 size={14} /> Delete selected</button>
            </div>
          </div>
        )}

        <div className="panel-spacer" />
        <section className="export-block">
          <div className="export-heading">
            <div>
              <span className="section-title">Export</span>
              <strong>{lines.length ? `${formatDistance(totalLength)} total` : "No lines"}</strong>
            </div>
            {lines.length > 0 && <button type="button" className="clear-link" onClick={clearLines}>Clear</button>}
          </div>
          <div className="export-actions">
            <button type="button" onClick={exportKmz} disabled={!lines.length}>
              <FileArchive size={17} />
              <span><strong>KMZ</strong><small>Google Earth</small></span>
              <Download size={15} />
            </button>
            <button type="button" onClick={exportShapefile} disabled={!lines.length}>
              <Layers3 size={17} />
              <span><strong>SHP</strong><small>Zipped bundle</small></span>
              <Download size={15} />
            </button>
          </div>
        </section>
      </aside>

      <div className="coordinate-readout" aria-label="Map coordinates">
        <span>{pointer[1].toFixed(5)}° N</span>
        <i />
        <span>{Math.abs(pointer[0]).toFixed(5)}° W</span>
        <i />
        <span>Z {zoom.toFixed(1)}</span>
      </div>

      {isDrawing && (
        <div className="drawing-pill"><span /> Drawing</div>
      )}

      {notice && (
        <div className={`toast ${notice.tone}`} role="status">
          <span>{notice.tone === "success" ? "✓" : notice.tone === "error" ? "!" : "i"}</span>
          <p>{notice.text}</p>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      {dragActive && (
        <div className="drop-overlay">
          <div><Upload size={28} /><strong>Drop GeoTIFF</strong></div>
        </div>
      )}
    </main>
  );
}
