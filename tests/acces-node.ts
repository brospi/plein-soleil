/** Accès réseau pour les tests hors navigateur (fetch de Node, sans cache). */
import { type Acces } from '../src/moteur/scene';
import { requeteBinaire, requeteJson } from '../src/donnees/reseau';
import { decoderPng } from '../src/donnees/png';

export const accesNode: Acces = {
  binaire: (url, service) => requeteBinaire(url, { service }, 'image/x-bil'),
  image: async (url, _l, _h, service) => (await decoderPng(await requeteBinaire(url, { service }, 'image/png'))).rgba,
  json: (url, service) => requeteJson(url, { service }),
};
