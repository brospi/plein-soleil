import { describe, expect, it } from 'vitest';
import { decoderEtat, encoderEtat, etatInitial, nouvelleFenetre, versSpec } from '../src/ui/etat';
import { ModeArbres } from '../src/coeur/simulation';

describe('partage par URL', () => {
  it('aller-retour complet de l’état', () => {
    const e = etatInitial();
    e.adresse = { libelle: '10 Rue de l’Église, 75015 Paris', x: 648123.4, y: 6860456.7 };
    e.reglages = { hauteurEtage: 2.8, hauteurEtageAuto: true, allege: 1, arbres: ModeArbres.Persistants, transmissionHiver: 0.35, troubleLinke: 3 };
    e.fenetres = [nouvelleFenetre(648120.12, 6860450.55, 197.35, 3), { ...nouvelleFenetre(648130, 6860470, 17.35, 3), balcon: true, hauteurLibre: 11.25 }];
    e.actif = 1;
    const code = encoderEtat(e);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decoderEtat(code)).toEqual(e);
  });
  it('code invalide ou malveillant : rejeté ou borné', () => {
    expect(decoderEtat('pas-du-base64-valide!!')).toBeNull();
    expect(decoderEtat(btoa('{"v":2}'))).toBeNull();
    const e = decoderEtat(btoa(JSON.stringify({ v: 1, a: null, r: [99, -5, 7, 3, 0], i: 12, f: [[1, 2, 720, 999, -1, 100, 100, 9, 1, 50, 50]] })))!;
    expect(e.reglages.hauteurEtage).toBe(5);
    expect(e.reglages.allege).toBe(0);
    expect(e.fenetres[0].largeur).toBe(8);
    expect(e.fenetres[0].etage).toBe(60);
    expect(e.actif).toBe(0);
  });
  it('la normale est reconstruite depuis l’azimut', () => {
    const s = versSpec(nouvelleFenetre(0, 0, 90, 0));
    expect(s.nx).toBeCloseTo(1, 6);
    expect(s.ny).toBeCloseTo(0, 6);
  });
});
