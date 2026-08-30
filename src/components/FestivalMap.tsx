import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ExternalLink } from "lucide-react";

export interface MapVenue {
  id: number;
  festival_id: number | null;
  municipality: string | null;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  area?: string | null;
}

// Leaflet's default marker icons resolve to CDN-hosted image URLs in dev; fix
// them explicitly so pins render in production builds too.
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export default function FestivalMap({ venues }: { venues: MapVenue[] }) {
  const valid = venues.filter(v => typeof v.lat === "number" && typeof v.lng === "number" && !isNaN(v.lat as number) && !isNaN(v.lng as number));
  if (!valid.length) return null;
  const center: [number, number] = [valid[0].lat as number, valid[0].lng as number];
  return (
    <MapContainer center={center} zoom={14} scrollWheelZoom={false} className="h-full w-full z-0">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {valid.map(v => (
        <Marker key={v.id} position={[v.lat as number, v.lng as number]}>
          <Popup>
            <div className="text-left min-w-[170px]">
              <p className="font-bold text-sm">{v.name}</p>
              {v.address && <p className="text-xs text-muted-foreground mt-0.5">{v.address}</p>}
              <a className="text-xs text-blue-600 underline inline-flex items-center gap-1 mt-1" target="_blank" rel="noreferrer"
                href={`https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`}>
                <ExternalLink className="w-3 h-3" /> Get directions
              </a>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}