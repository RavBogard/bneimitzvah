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
// Curriculum whole-verse mappings from explicitly labeled, credited source sheets:
// https://voices.sefaria.org/sheets/415562 (Genesis 1:1)
// https://voices.sefaria.org/sheets/590947 (Genesis 1:27-30)
// https://voices.sefaria.org/sheets/381876 (Genesis 22:1-4)
// https://voices.sefaria.org/sheets/571182 (Numbers 6:26-27)
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
  { kind: 'torah', ref: 'Genesis 1:27', sha256: '922524efcf76c57366e89095cb503294636f5a651d215d4e371a312e8ee12cb9', sourceId: 418005 },
  { kind: 'torah', ref: 'Genesis 1:28', sha256: '05144eee35abd88d58ce9a3cb5bf521e1db8332bbf613af6e917f4ff99696a36', sourceId: 418007 },
  { kind: 'torah', ref: 'Genesis 1:29', sha256: '226222e6eed21da37132567d5c729e3822085e8ecbbed03868ec156f27c36441', sourceId: 418006 },
  { kind: 'torah', ref: 'Genesis 1:30', sha256: 'fe57603bcf464e5ee0eb619a0e555b8b1850f57d9fedf3927c6871b33beaacb3', sourceId: 418008 },
  { kind: 'torah', ref: 'Numbers 6:26', sha256: '3b962cdbe320e0336df71768f3772188fcf7c4a45fe03725b08d03921a58c420', sourceId: 417047 },
  { kind: 'torah', ref: 'Numbers 6:27', sha256: '8b7a62f56115d77a77a474a9fd0246d0aef93e56ae27111dc580887b286c51df', sourceId: 417048 },
  { kind: 'torah', ref: 'Genesis 22:1', sha256: '93262ec1875305b26bf6ff97219c4cfe3e8ced0dda98b414f3b5d7a66d108d5f', sourceId: 434118 },
  { kind: 'torah', ref: 'Genesis 22:2', sha256: '09d4903b86ea0130b333d5ff55040b9529acf7a240b0618835d6d911710e91f2', sourceId: 434120 },
  { kind: 'torah', ref: 'Genesis 22:3', sha256: '225b1945bcc93137d26b5b0c22d3f1aaa7ecb0c20daff78db06f3c053bb230ee', sourceId: 434119 },
  { kind: 'torah', ref: 'Genesis 22:4', sha256: '0a9714808040692cda9010f6321c567b3697682ed8488098d3c4efe9a8ce8f1c', sourceId: 434121 },
  { kind: 'torah', ref: 'Genesis 1:1', sha256: '8ae854894758e23cfae8e06558679298f68558a10a39fb802efca1249e6c2bf6', sourceId: 417980 },
] as const;

