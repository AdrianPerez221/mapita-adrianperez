export function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
    const R = 6371000;
    const toRad = (x: number) => (x * Math.PI) / 180;
  
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
  
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
  
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  
  export function bboxAround(lat: number, lon: number, deltaDeg: number) {
    // OGC bbox suele ir lon,lat
    const minLat = lat - deltaDeg;
    const maxLat = lat + deltaDeg;
    const minLon = lon - deltaDeg;
    const maxLon = lon + deltaDeg;
    return { minLat, minLon, maxLat, maxLon };
  }
  