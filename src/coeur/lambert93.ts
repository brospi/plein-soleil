/**
 * Projection Lambert 93 (EPSG:2154) — conique conforme sécante sur l'ellipsoïde
 * GRS80, formules et constantes de la note IGN NTG_71.
 */

const RAD = Math.PI / 180;
const E = 0.0818191910428158; // première excentricité GRS80
const N = 0.725607765053267; // exposant de la projection
const C = 11754255.426096; // constante de la projection (m)
const XS = 700000;
const YS = 12655612.049876;
const LON0 = 3 * RAD; // méridien central : 3° Est

export interface PointL93 {
  x: number;
  y: number;
}
export interface PointGeo {
  lon: number;
  lat: number;
}

/** Longitude/latitude (degrés, RGF93 ≈ WGS84) → Lambert 93 (mètres). */
export function versLambert93(lon: number, lat: number): PointL93 {
  const phi = lat * RAD;
  const sinPhi = Math.sin(phi);
  const latIso = Math.atanh(sinPhi) - E * Math.atanh(E * sinPhi);
  const r = C * Math.exp(-N * latIso);
  const gamma = N * (lon * RAD - LON0);
  return { x: XS + r * Math.sin(gamma), y: YS - r * Math.cos(gamma) };
}

/** Lambert 93 (mètres) → longitude/latitude (degrés). */
export function depuisLambert93(x: number, y: number): PointGeo {
  const dx = x - XS;
  const dy = YS - y;
  const r = Math.hypot(dx, dy);
  const gamma = Math.atan2(dx, dy);
  const lon = LON0 + gamma / N;
  const latIso = -Math.log(r / C) / N;
  let phi = 2 * Math.atan(Math.exp(latIso)) - Math.PI / 2;
  for (let i = 0; i < 8; i++) {
    const es = E * Math.sin(phi);
    phi = 2 * Math.atan(Math.pow((1 + es) / (1 - es), E / 2) * Math.exp(latIso)) - Math.PI / 2;
  }
  return { lon: lon / RAD, lat: phi / RAD };
}

/**
 * Convergence des méridiens (degrés) : angle dont il faut tourner depuis le
 * nord de la grille Lambert pour obtenir le nord géographique, compté positif
 * vers l'ouest. Un azimut géographique A correspond à l'azimut « grille »
 * A − convergence. Vaut environ −0,5° à Paris, +3,4° à Strasbourg, −5,4° à Brest.
 */
export function convergenceMeridiens(lon: number): number {
  return N * (lon - 3);
}
