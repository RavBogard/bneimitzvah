// Public recording metadata only. Audio is acquired and held outside Git.
// Institution attributes its recordings to Cantor Wendy Shermet:
// https://www.templeisraelomaha.com/cantors-classroom
// Exodus whole-verse mappings (Full Verse Chanted, not trope examples):
// https://voices.sefaria.org/sheets/386127
// https://voices.sefaria.org/sheets/548290
// Micah rows independently verified in the official public page:
// https://www.templeisraelomaha.com/micah-718-20.html
// https://www.templeisraelomaha.com/special-haftarot.html
// sourceId resolves only under https://images.shulcloud.com/14396/<id>.mp3.
export const SHERMET_PILOT_RECORDINGS = [
  { kind: 'torah', ref: 'Exodus 35:1', sha256: '18107e0dd5dda83d97afafa3e0cd6ff33c592149b8fbb6e5a909bf927325cf6c', sourceId: 419834 },
  { kind: 'torah', ref: 'Exodus 35:2', sha256: '764aca460c2d0f4945afde435e5b4ea3307960fae1f85ede7dec7b60c993a407', sourceId: 419838 },
  { kind: 'torah', ref: 'Exodus 35:3', sha256: '25a1b366496acbda8223b5fa05423f48db5bba9e3caf90b2665fd4cbcc375d86', sourceId: 419839 },
  { kind: 'torah', ref: 'Exodus 35:4', sha256: '01967fa0fc739d9df9c341e73a99bca9169d21a1fda66b722a9747827683ba1d', sourceId: 419840 },
  { kind: 'torah', ref: 'Exodus 35:5', sha256: 'c37cbf36505e64be2be02881dcfcb74df03eaa554cdcdf0762a6e00d799bb388', sourceId: 419843 },
  { kind: 'torah', ref: 'Exodus 35:6', sha256: 'ff7997cbd31a1092d4629c44ccecc1e96acf7f5d710d76639f22ccdb668715e3', sourceId: 419841 },
  { kind: 'haftarah', ref: 'Micah 7:18', sha256: '239110b5a0f2934806d66e904bbce0c64a63dd566dc3e4ec53d52386a995730e', sourceId: 433533 },
  { kind: 'haftarah', ref: 'Micah 7:19', sha256: '256d10cc63e854c5ec6d3a40400fdf2440a656bf1fb9fe2572bd1edb43bc0496', sourceId: 433534 },
  { kind: 'haftarah', ref: 'Micah 7:20', sha256: 'b9f4cc18009c9ae6a2257dc74b3850af0795ffb55572e81709829b06e2586db2', sourceId: 433538 },
] as const;
