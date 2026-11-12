import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErreurReseau, requete, requeteJson } from '../src/donnees/reseau';

function reponses(...suite: Array<Response | Error>): ReturnType<typeof vi.fn> {
  const f = vi.fn(async () => {
    const r = suite.shift();
    if (!r) throw new Error('plus de réponse simulée');
    if (r instanceof Error) throw r;
    return r;
  });
  vi.stubGlobal('fetch', f);
  return f;
}

describe('relances réseau', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('relance sur 400 passager, 429, 504 et coupure réseau, puis réussit', async () => {
    for (const echec of [new Response('', { status: 400 }), new Response('', { status: 429 }), new Response('', { status: 504 }), new TypeError('Failed to fetch')]) {
      const f = reponses(echec, new Response('ok', { status: 200 }));
      const attentes: number[] = [];
      const p = requete('https://exemple.test/a', { service: 'de test', surAttente: (a) => attentes.push(a.delaiMs) });
      await vi.advanceTimersByTimeAsync(2000);
      expect(await (await p).text()).toBe('ok');
      expect(f).toHaveBeenCalledTimes(2);
      expect(attentes).toEqual([1200]);
    }
  });

  it('les relances contournent le cache du navigateur (erreur IGN mise en cache 21 jours)', async () => {
    const f = reponses(new Response('<ServiceException/>', { status: 400, headers: { 'Cache-Control': 'private, max-age=1814400' } }), new Response('ok'));
    const p = requete('https://exemple.test/a', { service: 'de test' });
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect((f.mock.calls[0][1] as RequestInit).cache).toBe('default');
    expect((f.mock.calls[1][1] as RequestInit).cache).toBe('reload');
  });

  it('respecte l’en-tête Retry-After', async () => {
    reponses(new Response('', { status: 429, headers: { 'Retry-After': '4' } }), new Response('ok'));
    const attentes: number[] = [];
    const p = requete('https://exemple.test/a', { service: 'de test', surAttente: (a) => attentes.push(a.delaiMs) });
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(attentes).toEqual([4000]);
  });

  it('ne relance pas une erreur définitive (404)', async () => {
    const f = reponses(new Response('', { status: 404 }));
    await expect(requete('https://exemple.test/a', { service: 'de test' })).rejects.toThrow(ErreurReseau);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('abandonne après quatre essais avec un message précis', async () => {
    const f = reponses(...[1, 2, 3, 4].map(() => new Response('', { status: 504 })));
    const p = requete('https://exemple.test/a', { service: 'd’altimétrie' });
    const echec = expect(p).rejects.toThrow(/d’altimétrie.*momentanément indisponible.*504/);
    await vi.advanceTimersByTimeAsync(30_000);
    await echec;
    expect(f).toHaveBeenCalledTimes(4);
  });

  it('relance quand un JSON attendu n’en est pas (page technique avec un code 200)', async () => {
    const f = reponses(new Response('# HELP jmx_exporter', { status: 200 }), new Response('{"features":[]}', { status: 200 }));
    const p = requeteJson('https://exemple.test/wfs', { service: 'BD TOPO' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toEqual({ features: [] });
    expect(f).toHaveBeenCalledTimes(2);
  });
});
