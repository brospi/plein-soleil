import { describe, expect, it } from 'vitest';
import { Classe, construireSurfaces, decoderClasses } from '../src/coeur/classification';
import { creerRaster, SANS_DONNEE } from '../src/coeur/raster';
import { lisserRelief, maillerRelief } from '../src/coeur/maillage';
import { construireCsv } from '../src/ui/export';
import { creneauxDeSoleil } from '../src/ui/graphiques/journee';
import { Etat } from '../src/coeur/simulation';
import { directNormal, masseAir } from '../src/coeur/cielclair';
import { empriseCalee } from '../src/donnees/ign';

describe('classification LiDAR', () => {
  it('décode la palette de la carte de classes', () => {
    const rgba = new Uint8Array([207, 150, 70, 255, 70, 150, 60, 255, 180, 20, 20, 255, 0, 0, 0, 0, 240, 240, 0, 255, 40, 140, 140, 255, 181, 22, 19, 255]);
    expect(Array.from(decoderClasses(rgba, 7))).toEqual([Classe.Sol, Classe.Vegetation, Classe.Batiment, Classe.Inconnu, Classe.Pont, Classe.Eau, Classe.Batiment]);
  });

  it('retire les arbres de la surface dure et les place dans la canopée', () => {
    // 10 × 10 cellules : sol à 30 m, un immeuble de 15 m à gauche, un arbre de 10 m à droite avec une frange mal classée.
    const mns = creerRaster(0, 10, 1, 10, 10, 30);
    const mnt = creerRaster(0, 10, 1, 10, 10, 30);
    const classes = new Uint8Array(100).fill(Classe.Sol);
    for (let l = 2; l < 8; l++) {
      for (let c = 0; c < 3; c++) {
        mns.d[l * 10 + c] = 45;
        classes[l * 10 + c] = Classe.Batiment;
      }
      for (let c = 6; c < 9; c++) {
        mns.d[l * 10 + c] = 40;
        classes[l * 10 + c] = Classe.Vegetation;
      }
      // Frange du houppier : haute dans le MNS mais classée « sol ».
      mns.d[l * 10 + 9] = 38;
    }
    const s = construireSurfaces(mns, mnt, classes);
    expect(s.dur.d[4 * 10 + 1]).toBe(45); // immeuble conservé
    expect(s.dur.d[4 * 10 + 7]).toBe(30); // sol sous l'arbre
    expect(s.arbres.d[4 * 10 + 7]).toBe(40);
    expect(s.arbres.d[4 * 10 + 1]).toBe(SANS_DONNEE);
    expect(s.dur.d[4 * 10 + 9]).toBe(30); // frange rattachée à l'arbre
    expect(s.arbres.d[4 * 10 + 9]).toBe(38);
    expect(s.classes[4 * 10 + 9]).toBe(Classe.Vegetation);
  });

  it('sans carte de classes, tout obstacle est opaque', () => {
    const mns = creerRaster(0, 4, 1, 4, 4, 30);
    mns.d[5] = 42;
    const s = construireSurfaces(mns, creerRaster(0, 4, 1, 4, 4, 30), null);
    expect(s.dur.d[5]).toBe(42);
    expect(s.arbres.d[5]).toBe(SANS_DONNEE);
  });
});

describe('maillage 3D', () => {
  // Un bloc de 10 m posé sur un sol plat.
  const n = 12;
  const h = new Float32Array(n * n);
  for (let l = 4; l < 8; l++) for (let c = 4; c < 8; c++) h[l * n + c] = 10;
  const m = maillerRelief(h, null, n, n, 0.5, { seuil: 1.2, ox: 0, oz: 0, z0: 0 });

  it('les murs sont strictement verticaux', () => {
    expect(m.indicesMurs.length).toBeGreaterThan(0);
    for (let t = 0; t < m.indicesMurs.length; t += 3) {
      const [a, b, c] = [m.indicesMurs[t], m.indicesMurs[t + 1], m.indicesMurs[t + 2]];
      const p = (i: number) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
      const [pa, pb, pc] = [p(a), p(b), p(c)];
      // Normale du triangle : composante verticale nulle.
      const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const ny = u[2] * v[0] - u[0] * v[2];
      expect(Math.abs(ny)).toBeLessThan(1e-9);
      expect(m.normales[a * 3 + 1]).toBe(0);
    }
  });

  it('aucune pente entre le toit et le sol : les dessus sont à 0 ou 10 m', () => {
    for (let t = 0; t < m.indicesToits.length; t += 3) {
      const ys = [0, 1, 2].map((k) => m.positions[m.indicesToits[t + k] * 3 + 1]);
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1e-6);
      // Tous les triangles de dessus regardent vers le haut.
      const i = [0, 1, 2].map((k) => m.indicesToits[t + k]);
      const p = (k: number) => [m.positions[i[k] * 3], m.positions[i[k] * 3 + 2]];
      const [pa, pb, pc] = [p(0), p(1), p(2)];
      const ny = (pb[1] - pa[1]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[1] - pa[1]);
      expect(ny).toBeGreaterThan(0);
    }
  });

  it('le lissage efface le bruit sans émousser les façades', () => {
    const bruite = h.map((v, i) => v + (i % 3) * 0.1);
    const lisse = lisserRelief(bruite, n, n);
    expect(lisse[5 * n + 5]).toBeGreaterThan(9.9);
    expect(lisse[5 * n + 5]).toBeLessThan(10.3);
    expect(lisse[1 * n + 1]).toBeLessThan(0.3);
    expect(Math.abs(lisse[5 * n + 4] - lisse[5 * n + 3])).toBeGreaterThan(9.5);
  });
});

describe('exports et affichage', () => {
  it('CSV au format français', () => {
    const z = new Float32Array(365);
    const heures = new Float32Array(365).fill(1.5);
    const csv = construireCsv({ adresse: '1 rue "Test", Paris', description: 'Fenêtre sud', heures, plein: z, reference: heures, energie: z });
    const lignes = csv.trim().split('\r\n');
    expect(lignes[0]).toBe('Plein Soleil;"1 rue ""Test"", Paris"');
    expect(lignes[4]).toBe('Date;Soleil direct (h);Plein soleil (h);Façade dégagée (h);Énergie directe (Wh/m²)');
    expect(lignes[5]).toBe('01/01/2026;1,50;0,00;1,50;0');
    expect(lignes[lignes.length - 1].startsWith('31/12/2026;')).toBe(true);
    expect(lignes).toHaveLength(5 + 365);
  });

  it('créneaux de soleil d’une journée', () => {
    const etats = new Uint8Array(720);
    etats.fill(Etat.SoleilPlein, 300, 360); // 10 h → 12 h
    etats.fill(Etat.SoleilPartiel, 362, 390); // interruption de 4 min, recollée
    etats.fill(Etat.SoleilPlein, 450, 480); // 15 h → 16 h
    expect(creneauxDeSoleil(etats)).toEqual([
      { debut: 600, fin: 780 },
      { debut: 900, fin: 960 },
    ]);
  });
});

describe('ciel clair (ESRA)', () => {
  it('masse d’air et éclairement direct plausibles', () => {
    expect(masseAir(90)).toBeCloseTo(1, 2);
    expect(masseAir(30)).toBeCloseTo(2, 1);
    expect(directNormal(0)).toBe(0);
    // Soleil haut, air clair : de l'ordre de 850 à 950 W/m².
    expect(directNormal(60)).toBeGreaterThan(820);
    expect(directNormal(60)).toBeLessThan(960);
    expect(directNormal(10)).toBeLessThan(directNormal(30));
    expect(directNormal(30, 1, 0, 5)).toBeLessThan(directNormal(30, 1, 0, 3));
  });
});

describe('requêtes calées (cache)', () => {
  it('deux points voisins produisent la même emprise', () => {
    const a = empriseCalee(652002, 6861990, 0.5, 1024, 32);
    const b = empriseCalee(652008, 6861996, 0.5, 1024, 32);
    expect(a).toEqual(b);
    // Le point reste à plus de 230 m de chaque bord.
    expect(652002 - a.x0).toBeGreaterThan(230);
    expect(a.x0 + 512 - 652002).toBeGreaterThan(230);
  });
});
