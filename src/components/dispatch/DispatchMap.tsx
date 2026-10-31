import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { NearDriver, Place } from '../../lib/dispatch';

// The dispatch map (OpenStreetMap): pickup, destination and the drivers
// near the pickup. When `picking` is set, a click on the map drops that pin.
const KIGALI: L.LatLngTuple = [-1.9536, 30.0906];
const pin = (color: string, letter: string) => L.divIcon({
  className: '',
  html: `<div style="background:${color};color:#fff;width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"><span style="transform:rotate(45deg);font:700 12px system-ui">${letter}</span></div>`,
  iconSize: [26, 26], iconAnchor: [13, 26],
});
const PICKUP = pin('#2563eb', 'A');
const DESTINATION = pin('#ea580c', 'B');

export default function DispatchMap({ pickup, destination, drivers, picking, onPick, height = 300 }: {
  pickup: Place | null; destination: Place | null; drivers: NearDriver[];
  picking: 'pickup' | 'destination' | null; onPick: (which: 'pickup' | 'destination', lat: number, lng: number) => void; height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pickRef = useRef({ picking, onPick });
  pickRef.current = { picking, onPick };

  useEffect(() => {
    if (!box.current || map.current) return;
    const m = L.map(box.current, { zoomControl: true, attributionControl: true }).setView(KIGALI, 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => { const p = pickRef.current; if (p.picking) p.onPick(p.picking, e.latlng.lat, e.latlng.lng); });
    map.current = m;
    // The box may have been sized after mount (tabs, modals).
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(box.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const pts: L.LatLngTuple[] = [];
    for (const d of drivers) {
      if (d.lat == null || d.lng == null) continue;
      L.circleMarker([d.lat, d.lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#16a34a', fillOpacity: 1 })
        .bindTooltip(`${d.name ?? `Driver #${d.id}`}${d.distance_km != null ? ` · ${d.distance_km} km` : ''}`).addTo(g);
    }
    if (pickup) { L.marker([pickup.lat, pickup.lng], { icon: PICKUP }).bindTooltip(`Pickup: ${pickup.address}`).addTo(g); pts.push([pickup.lat, pickup.lng]); }
    if (destination) { L.marker([destination.lat, destination.lng], { icon: DESTINATION }).bindTooltip(`Destination: ${destination.address}`).addTo(g); pts.push([destination.lat, destination.lng]); }
    if (pickup && destination) L.polyline(pts, { color: '#64748b', weight: 2, dashArray: '6 6' }).addTo(g);
    if (pts.length === 2) m.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 15 });
    else if (pts.length === 1) m.setView(pts[0], Math.max(m.getZoom(), 15));
  }, [pickup, destination, drivers]);

  useEffect(() => { if (box.current) box.current.style.cursor = picking ? 'crosshair' : ''; }, [picking]);

  return <div ref={box} style={{ height }} className="w-full rounded-lg border border-line overflow-hidden z-0 [&_img]:!max-w-none [&_img]:!max-h-none" />;
}
