// Resumen del mes por Telegram: el primer día de cada mes, lo que gastaste,
// las cartas que conseguiste y cuánto subió o bajó la colección. Corre en GitHub Actions cada noche,
// después del aviso de alertas, y casi siempre no hace nada.
//
//   node --experimental-strip-types scripts/resumen.mjs [--today AAAA-MM-DD]
//
// Los datos no están en el repo (es público): la app los copia al gist secreto de las alertas
// (archivo ruta-pikachu-mes.json, ver src/nube.ts). El mensaje se arma con src/model/monthly.ts y lo
// que ya se mandó queda en ruta-pikachu-resumen.json del mismo gist. Usa los mismos secretos que las
// alertas (GIST_TOKEN, TELEGRAM_TOKEN y, si se quiere, TELEGRAM_CHAT_ID). No usa Claude: no cuesta nada.
//
// Los registros de Actions son públicos: aquí solo se imprime qué se hizo, nunca montos ni cartas.

import { MONTH_FILE, monthlyStep, SUMMARY_FILE } from '../src/model/monthly.ts';
import { fileJson, findGist, gh, SENT_FILE, tg } from './alertas.mjs';

async function main() {
  const i = process.argv.indexOf('--today');
  const day = i > 0 ? process.argv[i + 1] : new Date().toISOString().slice(0, 10);
  const { GIST_TOKEN, TELEGRAM_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  if (!GIST_TOKEN || !TELEGRAM_TOKEN) return console.log('Sin los secretos GIST_TOKEN y TELEGRAM_TOKEN: el resumen del mes está apagado.');

  const gist = await findGist(GIST_TOKEN);
  if (!gist) return console.log('Resumen del mes: la app todavía no copió nada al gist.');
  const data = await fileJson(gist.files[MONTH_FILE], GIST_TOKEN);
  if (!data) return console.log('Resumen del mes: falta que abras la app una vez con esta versión.');
  const state = (await fileJson(gist.files[SUMMARY_FILE], GIST_TOKEN)) ?? {};

  const step = monthlyStep(data, state, day);
  if (step.text) {
    const sent = (await fileJson(gist.files[SENT_FILE], GIST_TOKEN)) ?? {};
    const chat = TELEGRAM_CHAT_ID || sent.chat;
    if (!chat) return console.warn('Resumen del mes: el bot de Telegram todavía no tiene chat (ver el paso de alertas).');
    await tg(TELEGRAM_TOKEN, 'sendMessage', { chat_id: chat, text: step.text, disable_web_page_preview: true });
    console.log(`Resumen del mes enviado (${step.state.sent}).`);
  } else if (!state.base) console.log('Resumen del mes: activado. El primero llega el día 1.');
  else console.log('Resumen del mes: hoy no toca.');

  if (JSON.stringify(step.state) !== JSON.stringify(state)) {
    await gh(`/gists/${gist.id}`, GIST_TOKEN, {
      method: 'PATCH',
      body: JSON.stringify({ files: { [SUMMARY_FILE]: { content: JSON.stringify(step.state) } } }),
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (e) {
    console.warn(`Resumen del mes: ${e.message}`);
  }
}
