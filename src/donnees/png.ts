/**
 * Décodeur PNG minimal (8 bits, non entrelacé : RGBA, RGB ou palette).
 * Utilisé pour la carte de classes LiDAR : contrairement à un canvas, il rend
 * les valeurs exactes de la palette et fonctionne dans un Web Worker comme
 * dans Node.
 */

async function decompresser(donnees: Uint8Array): Promise<Uint8Array> {
  const flux = new Blob([donnees as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(flux).arrayBuffer());
}

export async function decoderPng(tampon: ArrayBuffer): Promise<{ largeur: number; hauteur: number; rgba: Uint8Array }> {
  const o = new Uint8Array(tampon);
  const vue = new DataView(tampon);
  if (o.length < 24 || o[0] !== 0x89 || o[1] !== 0x50) throw new Error('Image PNG invalide.');
  let p = 8;
  let largeur = 0;
  let hauteur = 0;
  let type = 6;
  let palette: Uint8Array | null = null;
  let alpha: Uint8Array | null = null;
  const morceaux: Uint8Array[] = [];
  let total = 0;
  while (p + 8 <= o.length) {
    const n = vue.getUint32(p);
    const nom = String.fromCharCode(o[p + 4], o[p + 5], o[p + 6], o[p + 7]);
    const data = o.subarray(p + 8, p + 8 + n);
    if (nom === 'IHDR') {
      largeur = vue.getUint32(p + 8);
      hauteur = vue.getUint32(p + 12);
      type = o[p + 17];
      if (o[p + 16] !== 8 || o[p + 20] !== 0) throw new Error('Format PNG non géré (profondeur ou entrelacement).');
    } else if (nom === 'PLTE') palette = data.slice();
    else if (nom === 'tRNS') alpha = data.slice();
    else if (nom === 'IDAT') {
      morceaux.push(data);
      total += n;
    } else if (nom === 'IEND') break;
    p += 12 + n;
  }
  const idat = new Uint8Array(total);
  let q = 0;
  for (const m of morceaux) {
    idat.set(m, q);
    q += m.length;
  }
  const canaux = type === 6 ? 4 : type === 2 ? 3 : type === 4 ? 2 : 1;
  const brut = await decompresser(idat);
  const pas = largeur * canaux;
  const lignes = new Uint8Array(hauteur * pas);
  for (let y = 0; y < hauteur; y++) {
    const f = brut[y * (pas + 1)];
    const base = y * (pas + 1) + 1;
    const ligne = y * pas;
    for (let x = 0; x < pas; x++) {
      const a = x >= canaux ? lignes[ligne + x - canaux] : 0;
      const b = y > 0 ? lignes[ligne - pas + x] : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) {
        const c = x >= canaux && y > 0 ? lignes[ligne - pas + x - canaux] : 0;
        const e = a + b - c;
        const pa = Math.abs(e - a);
        const pb = Math.abs(e - b);
        const pc = Math.abs(e - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      lignes[ligne + x] = (brut[base + x] + pred) & 255;
    }
  }
  const n = largeur * hauteur;
  const rgba = new Uint8Array(n * 4);
  if (type === 6) rgba.set(lignes);
  else {
    for (let i = 0; i < n; i++) {
      if (type === 2) {
        rgba[i * 4] = lignes[i * 3];
        rgba[i * 4 + 1] = lignes[i * 3 + 1];
        rgba[i * 4 + 2] = lignes[i * 3 + 2];
        rgba[i * 4 + 3] = 255;
      } else if (type === 3 && palette) {
        const k = lignes[i];
        rgba[i * 4] = palette[k * 3];
        rgba[i * 4 + 1] = palette[k * 3 + 1];
        rgba[i * 4 + 2] = palette[k * 3 + 2];
        rgba[i * 4 + 3] = alpha && k < alpha.length ? alpha[k] : 255;
      } else {
        const g = lignes[i * canaux];
        rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = g;
        rgba[i * 4 + 3] = type === 4 ? lignes[i * 2 + 1] : 255;
      }
    }
  }
  return { largeur, hauteur, rgba };
}
