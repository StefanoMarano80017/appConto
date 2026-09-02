import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * La build di produzione del backend.
 *
 * Produce un artefatto autosufficiente: **un solo file JavaScript** con tutte
 * le dipendenze inlinate, più il binario nativo di SQLite accanto ad esso.
 * Nessun `node_modules` è necessario per eseguirlo, ed è questo che rende
 * possibile il package portatile di WP-P4.
 *
 * Lo stesso artefatto serve `npm start` e il package: non esistono due build
 * diverse, quindi un problema di confezionamento si manifesta già in sviluppo.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendSrc = path.join(repoRoot, 'apps', 'backend', 'src');
const outDir = path.join(repoRoot, 'apps', 'backend', 'dist');
const outFile = path.join(outDir, 'server.js');
const launcherFile = path.join(outDir, 'launcher.js');

/**
 * Due artefatti, una sola cartella.
 *
 * `server.js` è l'applicazione; `launcher.js` è ciò che l'avvia, la sorveglia
 * e la ferma. Vivono **accanto**, e non è una comodità: `paths.ts` deduce
 * `APP_ROOT` dai segmenti finali del percorso del proprio modulo, quindi due
 * bundle nella stessa cartella risolvono le due radici in modo identico. Se il
 * launcher stesse in una sottocartella propria, dedurrebbe un `APP_ROOT`
 * diverso da quello del server — cioè esattamente la divergenza che questo
 * progetto ha costruito `paths.ts` per rendere impossibile.
 */
const entryPoints = {
  server: path.join(backendSrc, 'main.ts'),
  launcher: path.join(backendSrc, 'launcher', 'main.ts'),
};

/**
 * Ciò che manca a un bundle ESM per poter contenere codice CommonJS.
 *
 * `better-sqlite3` carica il proprio binario con un `require` costruito a
 * runtime. esbuild non può risolverlo staticamente, quindi lo lascia al suo
 * shim, che delega a un `require` reale **se ne trova uno in scope**. In un
 * modulo ESM non ce n'è: senza queste righe l'avvio muore su
 * `Dynamic require of "fs" is not supported`.
 *
 * `__filename` e `__dirname` sono nello stesso banner perché appartengono allo
 * stesso problema: sono definiti in CommonJS e non in ESM, e del codice
 * inlinato può usarli. Nel bundle valgono il file e la cartella del bundle,
 * che è esattamente ciò che quel codice si aspetta.
 */
const CJS_BANNER = [
  "import { createRequire as __portableCreateRequire } from 'node:module';",
  "import { fileURLToPath as __portableFileURLToPath } from 'node:url';",
  "import { dirname as __portableDirname } from 'node:path';",
  'const require = __portableCreateRequire(import.meta.url);',
  'const __filename = __portableFileURLToPath(import.meta.url);',
  'const __dirname = __portableDirname(__filename);',
].join('\n');

/** Il nome del prebuild che serve a questa macchina. */
function prebuildName(platform, arch) {
  const musl =
    platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime
      ? 'linuxmusl'
      : platform;

  return `${musl}-${arch}.node`;
}

/** La cartella di `better-sqlite3` dentro `node_modules`. */
function betterSqlite3Root() {
  const require = createRequire(import.meta.url);

  return path.dirname(require.resolve('better-sqlite3/package.json'));
}

/**
 * Copia il binario SQLite accanto al bundle.
 *
 * Accanto e non altrove: `paths.ts` lo cerca in `native/` a fianco del modulo,
 * e la stessa regola vale nel repository e nel package. Così `npm start` prova
 * lo stesso percorso di caricamento che userà la cartella portatile.
 */
function copyNativeBinding(targetDir, platform, arch) {
  const source = path.join(betterSqlite3Root(), 'prebuilds', prebuildName(platform, arch));
  const destination = path.join(targetDir, 'native', 'better_sqlite3.node');

  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);

  return { source, destination, bytes: statSync(destination).size };
}

export async function buildBackend() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  await build({
    entryPoints,
    outdir: outDir,
    // I nomi degli artefatti sono un contratto: `start.bat` avvia
    // `launcher.js`, il launcher avvia `server.js`, e `npm start` avvia
    // `server.js`. Niente impronte nei nomi.
    entryNames: '[name]',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner: { js: CJS_BANNER },
    // I moduli nativi non si possono inlinare: restano file a sé.
    external: ['*.node'],
    // `external` e non `inline`: il sourcemap resta nel repository per le
    // diagnosi e il bundle non ne porta il riferimento, quindi il package non
    // contiene né i sorgenti né un rimando a un file che non ha.
    sourcemap: 'external',
    logLevel: 'warning',
  });

  /*
   * Il tipo di modulo va dichiarato, non dedotto.
   *
   * Il bundle non contiene `import` di primo livello, quindi Node — in assenza
   * di questo file — lo classificherebbe come CommonJS con la propria euristica
   * sulla sintassi. Funzionerebbe per caso, e smetterebbe di funzionare al
   * primo `import` che esbuild decidesse di emettere. Dichiararlo rende il
   * comportamento identico dovunque la cartella venga copiata.
   */
  writeFileSync(path.join(outDir, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`, 'utf8');

  const native = copyNativeBinding(outDir, process.platform, process.arch);

  /*
   * Il launcher non deve contenere l'applicazione.
   *
   * Non apre nessun database e non serve nessuna pagina: avvia un processo che
   * fa entrambe le cose. Se un `import` sbagliato trascinasse dentro
   * `db/client.js`, il launcher aprirebbe il database **prima** di avere il
   * lock — cioè proprio ciò che il lock esiste per impedire — e lo farebbe in
   * silenzio, perché funzionerebbe.
   *
   * Il controllo guarda il contenuto e non gli import, perché è il contenuto a
   * finire nel package. Il criterio è strutturale: il launcher è ESM puro e
   * non carica nessun modulo CommonJS, quindi non può caricare un addon
   * nativo. Un `require(` di una stringa qualsiasi significa che qualcosa è
   * entrato. (I nomi `better_sqlite3.node` e `drizzle` compaiono comunque nel
   * bundle come *percorsi* — il launcher verifica che quei file esistano — e
   * per questo non sono un criterio utilizzabile.)
   */
  const launcherSource = readFileSync(launcherFile, 'utf8');
  const intrusi = [
    ...(/require\(\s*["'`]/.test(launcherSource)
      ? ['un modulo CommonJS, che nel launcher può essere solo un addon nativo']
      : []),
    ...['express', 'papaparse', 'drizzle-orm'].filter((nome) =>
      launcherSource.includes(`node_modules/${nome}`),
    ),
  ];

  if (intrusi.length > 0) {
    throw new Error(
      `launcher.js contiene ${intrusi.join(', ')}: il launcher avvia l'applicazione, non la contiene.`,
    );
  }

  return {
    bundle: outFile,
    bundleBytes: statSync(outFile).size,
    launcher: launcherFile,
    launcherBytes: statSync(launcherFile).size,
    native,
  };
}

/** Eseguito direttamente, e non importato dallo script di confezionamento. */
const eseguitoDirettamente =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (eseguitoDirettamente) {
  const esito = await buildBackend();
  const kb = (byte) => `${(byte / 1024).toFixed(0)} kB`;

  console.log(`  server.js              ${kb(esito.bundleBytes)}`);
  console.log(`  launcher.js            ${kb(esito.launcherBytes)}`);
  console.log(`  native/better_sqlite3  ${kb(esito.native.bytes)}  (${prebuildName(process.platform, process.arch)})`);
}
