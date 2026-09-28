#!/usr/bin/env bash
# Sei controlli oggettivi sul design system. Zero righe = passato.
#
# Il perimetro e' `src`, non `src/app`: fuori da `src/app` vivono
# `styles.scss` e i temi, che sono CSS a tutti gli effetti.
# Le estensioni includono `.ts`: un componente con `styles:` inline
# sfuggiva a tutti e cinque i controlli precedenti.
set -u
cd "$(dirname "$0")/.." || exit 2

fallimenti=0

verifica() {
  local nome="$1"; shift
  local righe
  righe="$("$@" 2>/dev/null)"
  if [ -n "$righe" ]; then
    printf '\n[FALLITO] %s\n%s\n' "$nome" "$righe"
    fallimenti=$((fallimenti + 1))
  else
    printf '[ok] %s\n' "$nome"
  fi
}

verifica 'nessun esadecimale fuori dai primitivi' \
  bash -c "grep -rnE ': *#[0-9a-fA-F]{3,8}' src --include=*.scss --include=*.ts | grep -v _primitives"

verifica 'nessuna dimensione di carattere fuori dalla scala' \
  bash -c "grep -rn 'font-size:' src --include=*.scss --include=*.ts | grep -v _typography"

verifica 'nessun raggio numerico fuori dai semantici' \
  bash -c "grep -rnE 'border-radius: *[0-9]' src --include=*.scss --include=*.ts | grep -v _semantic"

verifica 'nessuna spaziatura letterale fuori dai semantici' \
  bash -c "grep -rnE '(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left))?: *[^v;]*[0-9](rem|px)' src --include=*.scss --include=*.ts | grep -vE '_semantic|: *0(rem|px)?;'"

verifica 'shared non conosce le feature' \
  bash -c "grep -rn 'features/' src/app/shared"

verifica 'dominio intatto' \
  bash -c "git -C ../.. diff --name-only | grep -E '\.(model|api|store|query)\.ts\$|apps/backend'"

printf '\n%s\n' "controlli falliti: $fallimenti"
[ "$fallimenti" -eq 0 ]
