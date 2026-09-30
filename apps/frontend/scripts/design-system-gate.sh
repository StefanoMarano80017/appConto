#!/usr/bin/env bash
# Sette controlli oggettivi sul design system. Zero righe = passato.
#
# Il perimetro e' `src`, non `src/app`: fuori da `src/app` vivono
# `styles.scss` e i temi, che sono CSS a tutti gli effetti.
# Le estensioni includono `.ts`: un componente con `styles:` inline
# sfuggiva a tutti e cinque i controlli precedenti.
set -u
cd "$(dirname "$0")/.." || exit 2

fallimenti=0

# Un'eccezione dichiarata è una riga che porta il marcatore `ds-exception` nel
# proprio commento, col rimando al documento che la motiva. Non conta come
# fallimento, ma viene STAMPATA a ogni esecuzione.
#
# Serve perché esistono valori che la specifica chiede espressamente di NON
# unificare — il raggio di 4px delle celle modificabili in linea (§8), che deve
# restare letterale e locale. Senza un modo di dichiararle, quelle righe
# rendono «zero» irraggiungibile per sempre sui file che le contengono, e il
# criterio di uscita di ogni task su quei file degenera in un numero da
# ricordare a memoria, diverso per file. È così che un gate smette di essere
# un vincolo e diventa un rumore che si impara a ignorare.
#
# Stampate e non nascoste, di proposito: un'eccezione che sparisce dalla vista
# è un'eccezione che nessuno rivede più. Il marcatore rende il silenzio una
# scelta esplicita di chi scrive la riga, non un effetto collaterale.
verifica() {
  local nome="$1"; shift
  local tutte righe eccezioni
  tutte="$("$@" 2>/dev/null)"
  righe="$(printf '%s\n' "$tutte" | grep -v 'ds-exception')"
  eccezioni="$(printf '%s\n' "$tutte" | grep 'ds-exception')"
  if [ -n "$righe" ]; then
    printf '\n[FALLITO] %s\n%s\n' "$nome" "$righe"
    fallimenti=$((fallimenti + 1))
  else
    printf '[ok] %s\n' "$nome"
  fi
  if [ -n "$eccezioni" ]; then
    printf '  [eccezione dichiarata] %s\n%s\n' "$nome" "$eccezioni"
  fi
}

# Una riga di commento non è una dichiarazione. I cinque controlli sui valori la
# escludono, perché i commenti di questo progetto **citano** di continuo i valori
# e i nomi che stiamo togliendo — per documentare com'era prima, o perché una
# scelta è stata fatta così. Senza questo filtro il gate resta rosso su prosa che
# descrive il passato, e l'unico modo di farlo tacere sarebbe smettere di
# spiegarsi nei commenti: il contrario di quello che serve.
#
# Il filtro guarda cosa viene dopo il `file:riga:` che grep antepone. Un commento
# di coda (`color: red; // nota`) resta controllato, come deve: si scartano solo
# le righe che **iniziano** come un commento.
#
# La prima versione scartava ogni riga che iniziasse con `*`, sulla premessa che
# nessuna dichiarazione possa cominciare così. **La premessa era falsa**, e una
# review l'ha dimostrata con una prova: `* { padding: 8px; }` è il selettore
# universale, ed è CSS legittimo — spariva da tutti e cinque i controlli. Il
# difetto non era teorico: `* {` esiste già in `styles.scss`, oggi innocuo solo
# perché il valore sta sulla riga dopo.
#
# Il discriminante giusto è cosa segue l'asterisco: in una riga di commento lo
# segue del testo, nel selettore universale lo segue una graffa. Quindi si scarta
# `* qualcosa` e si tiene `* {` e `*{`.
#
# Sugli `.html` il filtro è più largo del necessario — l'HTML commenta con
# `<!--`, non con `//` o `/*` — ma una riga di testo di una pagina che cominci
# con quei caratteri e contenga un alias è prosa, non una dichiarazione. Lo
# dichiaro invece di sostenere, come prima, che il caso non esista.
senza_commenti() {
  grep -vE ':[0-9]+:[[:space:]]*(//|/\*)' \
    | grep -vE ':[0-9]+:[[:space:]]*\*[[:space:]]*[^{[:space:]]'
}
# I controlli girano in `bash -c`, che è una shell nuova: senza l'export la
# funzione non esisterebbe là dentro.
export -f senza_commenti

# Un esadecimale è una dichiarazione di colore se non è citato. Citato significa
# preceduto da apice singolo, doppio, backtick o parentesi: 'colore', "colore",
# `colore`, (ripiego). Il controllo esclude questi casi per non catturare i
# riferimenti ai colori (nelle fixture, nei commenti, nei valori di ripiego).
# Non vede gli esadecimali dentro template string CSS (backtick js) — è un limite noto.
verifica 'nessun esadecimale fuori dai primitivi' \
  bash -c "grep -rnE '#[0-9a-fA-F]{3,8}' src --include=*.scss --include=*.ts | grep -v _primitives | grep -vE \"['(\\\"\\\`]#\" | senza_commenti"

verifica 'nessuna dimensione di carattere fuori dalla scala' \
  bash -c "grep -rn 'font-size:' src --include=*.scss --include=*.ts | grep -v _typography | senza_commenti"

# Le unità relative al carattere (`em`, `ch`, `ex`) sono escluse: un
# Il `;` finale nel filtro non è decorativo: senza, una forma abbreviata come
# `border-radius: 0.15em 6px 6px 0.15em` sarebbe sparita per intero, nascondendo
# anche i due `6px` veri. Si esclude solo il caso in cui **tutto** il valore è
# relativo al carattere.
# `border-radius: 0.15em` non è un raggio della scala, è una proporzione che
# cresce col testo intorno. Nessun token fisso può sostituirlo senza togliergli
# la proprietà per cui è scritto così. `rem` invece resta controllato, perché è
# una misura assoluta travestita: `[0-9.]+` non può consumare la `r`.
verifica 'nessun raggio numerico fuori dai semantici' \
  bash -c "grep -rnE 'border-radius: *[0-9]' src --include=*.scss --include=*.ts | grep -v _semantic | grep -vE 'border-radius: *[0-9.]+(em|ch|ex) *;' | senza_commenti"

verifica 'nessuna spaziatura letterale fuori dai semantici' \
  bash -c "grep -rnE '(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left))?: *[^v;]*[0-9](rem|px)' src --include=*.scss --include=*.ts | grep -vE '_semantic|: *0(rem|px)?;' | senza_commenti"

verifica 'shared non conosce le feature' \
  bash -c "grep -rn 'features/' src/app/shared"

# Chart.js è parte della presentazione di un grafico e deve restare confinato
# nel modulo shared/ui/chart. Le feature possono usare i componenti pubblici
# (line-chart, line-chart.model) ma non le implementazioni interne.
verifica 'Chart.js resta dentro shared/ui/chart' \
  bash -c "grep -rn \"from ['\\\"']chart\\.js['\\\"']\" src/app --include='*.ts' | grep -v shared/ui/chart | grep -v '\\.spec\\.ts'; grep -rn \"from.*shared/ui/chart/\\(chart\\|line-chart-config\\|line-chart-theme\\|line-guides-plugin\\)['\\\"']\" src/app/features"

# Il nome dell'alias legacy deve essere seguito subito da ) o da , per evitare
# di catturare i nomi nuovi verso cui stiamo migrando: --border catturerebbe
# --border-width, --text catturerebbe --text-primary e --text-secondary.
# Questo vincolo discrimina i veri alias legacy dai nomi nuovi.
verifica 'nessun alias legacy' \
  bash -c "grep -rnE 'var\( *--(background|surface|border|text|text-muted|accent|on-accent|negative|positive|radius-panel|space-panel) *[,)]' src --include=*.scss --include=*.ts --include=*.html | grep -v _legacy-aliases | senza_commenti"

# `diff master`, non `diff` e basta: senza un termine di paragone git confronta
# l'albero di lavoro con l'indice, quindi bastava un `git add` — o un commit —
# perche' una modifica al dominio passasse come [ok]. Il controllo esisteva e
# non guardava. Con `master` come riferimento vede tutto cio' che il ramo ha
# cambiato, committato o no. Su master stesso resta il confronto con l'albero
# di lavoro, che e' l'unica cosa sensata da controllare li'.
verifica 'dominio intatto' \
  bash -c "git -C ../.. diff --name-only master | grep -E '\.(model|api|store|query)\.ts\$|apps/backend'"

printf '\n%s\n' "controlli falliti: $fallimenti"
[ "$fallimenti" -eq 0 ]
