import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fmtHoraRelativa } from '../src/lib/format';

/**
 * A hora curta da lista de conversas. O que se garante aqui é o corte
 * entre "hoje" e "ontem": ele é pelo dia em São Paulo, e um teste que
 * dependesse do relógio da máquina passaria ou falharia pelo horário em
 * que rodou.
 *
 * As strings de data são o que o MySQL devolve, e o MySQL do VPS grava
 * em UTC — por isso cada uma está três horas à frente da hora de São
 * Paulo que o teste espera ver na tela.
 */

// 10/05/2026 14:32 em São Paulo (UTC-3).
const AGORA = Date.parse('2026-05-10T17:32:00Z');
const minAtras = (n: number) => AGORA - n * 60_000;

describe('fmtHoraRelativa', () => {
  test('minuto a minuto até a hora cheia', () => {
    assert.equal(fmtHoraRelativa(minAtras(0), AGORA), 'agora');
    assert.equal(fmtHoraRelativa(minAtras(1), AGORA), '1 min');
    assert.equal(fmtHoraRelativa(minAtras(59), AGORA), '59 min');
  });

  test('mais de uma hora no mesmo dia vira a hora do relógio', () => {
    assert.equal(fmtHoraRelativa('2026-05-10 12:05:00', AGORA), '09:05');
  });

  test('da hora em diante o corte é o dia em São Paulo, não "24h atrás"', () => {
    // 08:00 de 11/05 em SP: a mensagem das 23:50 tem 8h, mas é de ontem.
    const manha = Date.parse('2026-05-11T11:00:00Z');
    assert.equal(fmtHoraRelativa('2026-05-11 02:50:00', manha), 'ontem');
    // Abaixo de uma hora o contador vence a virada do dia: "40 min"
    // informa mais do que "ontem" para quem está olhando a lista.
    const meiaNoite = Date.parse('2026-05-11T03:30:00Z');
    assert.equal(fmtHoraRelativa('2026-05-11 02:50:00', meiaNoite), '40 min');
  });

  test('a semana em dias, e depois a data', () => {
    assert.equal(fmtHoraRelativa('2026-05-08 13:00:00', AGORA), '2 d');
    assert.equal(fmtHoraRelativa('2026-05-01 13:00:00', AGORA), '01/05');
  });

  test('sem data não inventa texto, e futuro não vira número negativo', () => {
    assert.equal(fmtHoraRelativa(null, AGORA), '');
    assert.equal(fmtHoraRelativa('nada', AGORA), '');
    assert.equal(fmtHoraRelativa('2026-05-10 18:00:00', AGORA), '15:00');
  });
});
