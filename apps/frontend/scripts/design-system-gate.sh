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

# Un esadecimale è una dichiarazione di colore se non è citato. Citato significa
# preceduto da apice singolo, doppio, backtick o parentesi: 'colore', "colore",
# `colore`, (ripiego). Il controllo esclude questi casi per non catturare i
# riferimenti ai colori (nelle fixture, nei commenti, nei valori di ripiego).
# Non vede gli esadecimali dentro template string CSS (backtick js) — è un limite noto.
verifica 'nessun esadecimale fuori dai primitivi' \
  bash -c "grep -rnE '#[0-9a-fA-F]{3,8}' src --include=*.scss --include=*.ts | grep -v _primitives | grep -vE \"['(\\\"\\\`]#\""

verifica 'nessuna dimensione di carattere fuori dalla scala' \
  bash -c "grep -rn 'font-size:' src --include=*.scss --include=*.ts | grep -v _typography"

verifica 'nessun raggio numerico fuori dai semantici' \
  bash -c "grep -rnE 'border-radius: *[0-9]' src --include=*.scss --include=*.ts | grep -v _semantic"

verifica 'nessuna spaziatura letterale fuori dai semantici' \
  bash -c "grep -rnE '(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left))?: *[^v;]*[0-9](rem|px)' src --include=*.scss --include=*.ts | grep -vE '_semantic|: *0(rem|px)?;'"

verifica 'shared non conosce le feature' \
  bash -c "grep -rn 'features/' src/app/shared"

# Il nome dell'alias legacy deve essere seguito subito da ) o da , per evitare
# di catturare i nomi nuovi verso cui stiamo migrando: --border catturerebbe
# --border-width, --text catturerebbe --text-primary e --text-secondary.
# Questo vincolo discrimina i veri alias legacy dai nomi nuovi.
verifica 'nessun alias legacy' \
  bash -c "grep -rnE 'var\( *--(background|surface|border|text|text-muted|accent|on-accent|negative|positive|radius-panel|space-panel) *[,)]' src --include=*.scss --include=*.ts | grep -v _legacy-aliases"

verifica 'dominio intatto' \
  bash -c "git -C ../.. diff --name-only | grep -E '\.(model|api|store|query)\.ts\$|apps/backend'"

printf '\n%s\n' "controlli falliti: $fallimenti"
[ "$fallimenti" -eq 0 ]
