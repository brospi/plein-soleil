import { describe, expect, it } from 'vitest';
import { aretesDuBatiment, classerAretes, analyserPoint, azimutDe, anneauxDepuisGeoJSON, contient, positionDuMur, profilNormal, type Arete } from '../src/coeur/facades';
import { boite, scene, X0, Y0, SOL } from './scenes';

function areteVers(aretes: Arete[], azimut: number): Arete {
  return aretes.find((a) => Math.abs(azimutDe(a.nx, a.ny) - azimut) < 1)!;
}

describe('emprises et normales', () => {
  it('normale sortante quel que soit le sens de l’anneau', () => {
    const b = boite('a', 0, 0, 20, 10, 15);
    const direct = aretesDuBatiment(b, 0);
    const inverse = aretesDuBatiment({ ...b, anneaux: [{ trou: false, pts: [X0, Y0, X0, Y0 + 10, X0 + 20, Y0 + 10, X0 + 20, Y0] }] }, 0);
    for (const aretes of [direct, inverse]) {
      expect(aretes).toHaveLength(4);
      const azimuts = aretes.map((a) => Math.round(azimutDe(a.nx, a.ny))).sort((x, y) => x - y);
      expect(azimuts).toEqual([0, 90, 180, 270]);
      // La face sud (y minimal) regarde vers le sud.
      const sud = aretes.find((a) => a.ay === Y0 && a.by === Y0)!;
      expect(Math.round(azimutDe(sud.nx, sud.ny))).toBe(180);
    }
  });

  it('cour intérieure : la normale d’un trou pointe vers la cour', () => {
    const geo = {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [30, 0], [30, 30], [0, 30], [0, 0]],
        [[10, 10], [10, 20], [20, 20], [20, 10], [10, 10]],
      ],
    };
    const anneaux = anneauxDepuisGeoJSON(geo);
    expect(anneaux).toHaveLength(2);
    expect(anneaux[1].trou).toBe(true);
    const b = { id: 'c', anneaux, hauteur: 12, etages: null, usage: null };
    expect(contient(b, 5, 5)).toBe(true);
    expect(contient(b, 15, 15)).toBe(false);
    const aretes = aretesDuBatiment(b, 0);
    // Mur ouest de la cour (x = 10) : l'extérieur est la cour, donc vers l'est.
    const mur = aretes.find((a) => a.ax === 10 && a.bx === 10)!;
    expect(Math.round(azimutDe(mur.nx, mur.ny))).toBe(90);
  });
});

describe('murs mitoyens et position du mur', () => {
  it('deux immeubles accolés de même hauteur : le mur commun est mitoyen', () => {
    const a = boite('a', -20, 0, 20, 12, 18);
    const b = boite('b', 0, 0, 20, 12, 18);
    const { scene: s } = scene([a, b]);
    const aretes = aretesDuBatiment(a, 0);
    classerAretes(aretes, s.relief);
    expect(areteVers(aretes, 90).statut).toBe('mitoyen');
    expect(areteVers(aretes, 180).statut).toBe('libre');
    expect(areteVers(aretes, 0).statut).toBe('libre');
    expect(areteVers(aretes, 270).statut).toBe('libre');
    expect(areteVers(aretes, 180).nbEtages).toBe(6);
  });

  it('voisin plus bas : le mur n’est libre qu’au-dessus du toit voisin', () => {
    const a = boite('a', -20, 0, 20, 12, 21);
    const b = boite('b', 0, 0, 20, 12, 7);
    const { scene: s } = scene([a, b]);
    const aretes = aretesDuBatiment(a, 0);
    classerAretes(aretes, s.relief);
    const est = areteVers(aretes, 90);
    expect(est.statut).toBe('libre');
    // Toit voisin à 7 m : les fenêtres centrées à 1,7 m, 4,7 m et 7,7 m ont leur appui sous le toit voisin + 0,5 m.
    expect(est.etageMin).toBeGreaterThanOrEqual(2);
    expect(est.etageMin).toBeLessThanOrEqual(3);
  });

  it('décalage cadastre / LiDAR de 1,5 m : le mur réel est retrouvé', () => {
    const a = boite('a', -10, 0, 20, 12, 18);
    for (const dy of [-1.5, 1.5]) {
      const { scene: s } = scene([a], 300, [0, dy]);
      // Façade sud cadastrale en y = Y0 ; mur LiDAR en y = Y0 + dy. Normale vers le sud.
      const an = analyserPoint(s.relief, X0, Y0, 0, -1);
      expect(an.etageMin).toBe(0);
      expect(Math.abs(an.toit - (SOL + 18))).toBeLessThan(0.01);
      for (const e of an.etages) {
        expect(e.decalage).not.toBeNull();
        // Position le long de la normale (vers le sud) : −dy, à une demi-cellule près.
        expect(Math.abs(e.decalage! - -dy)).toBeLessThanOrEqual(0.4);
      }
    }
  });

  it('étage en retrait : le mur recule au dernier niveau', () => {
    const socle = boite('socle', -10, 0, 20, 12, 15);
    const attique = boite('attique', -10, 3, 20, 9, 18.5);
    const { scene: s } = scene([socle, attique]);
    const an = analyserPoint(s.relief, X0, Y0, 0, -1);
    const bas = an.etages[1];
    const haut = an.etages[an.etages.length - 1];
    expect(Math.abs(bas.decalage!)).toBeLessThan(0.4);
    expect(haut.z).toBeGreaterThan(SOL + 15);
    expect(Math.abs(haut.decalage! + 3)).toBeLessThan(0.4);
  });

  it('profil : passage étroit conservé, volume couvert rejeté', () => {
    const a = boite('a', -10, 0, 20, 12, 18);
    const enFace = boite('b', -10, -14, 20, 12.5, 18); // passage de 1,5 m
    const { scene: s } = scene([a, enFace]);
    const profil = profilNormal(s.relief.dur, X0, Y0, 0, -1);
    expect(positionDuMur(profil, SOL + 5)).not.toBeNull();
    expect(Math.abs(positionDuMur(profil, SOL + 5)!)).toBeLessThan(0.4);
    // Au-dessus du toit : pas de mur.
    expect(positionDuMur(profil, SOL + 25)).toBeNull();
  });
});
