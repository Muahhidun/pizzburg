/**
 * Разовая регистрация «кассы» PizzBurg в Kaspi Pay (схема 3).
 *
 * Kaspi пускает запросы только с наших статических IP, поэтому скрипт
 * запускается на боевом сервере (Railway → backend → Console), когда
 * сертификат и ИИН уже заданы в переменных, а KASPI_MODE ещё disabled:
 *
 *   node dist/payments/kaspi-register-device.js
 *       — показывает торговые точки (TradePointId и название);
 *   node dist/payments/kaspi-register-device.js --trade-point <id>
 *       — регистрирует устройство и печатает DeviceToken.
 *
 * DeviceToken копируется в переменную KASPI_DEVICE_TOKEN и больше нигде не
 * хранится. Повторный вызов с теми же аргументами Kaspi отвечает тем же
 * токеном, так что запуск безопасно повторить.
 */
import { randomUUID } from "node:crypto";
import {
  HttpsKaspiTransport,
  KaspiApiError,
  KaspiEnvelope,
  isRetryableCode,
  loadKaspiConfig,
} from "./kaspi.provider";

/// Идентификатор нашего «устройства» в Kaspi: один сервер на все заказы.
export const KASPI_DEVICE_ID = "pizzburg-server";

async function call<T>(
  transport: HttpsKaspiTransport,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, string>,
) {
  const envelope = await transport.request<KaspiEnvelope<T>>(
    method,
    path,
    randomUUID(),
    body,
  );
  const code = String(envelope.StatusCode);
  if (code !== "0") {
    throw new KaspiApiError(
      envelope.Message || `Kaspi вернул ошибку ${code}`,
      code,
      isRetryableCode(code),
    );
  }
  return envelope.Data as T;
}

async function main() {
  // На боевом KASPI_MODE остаётся disabled, пока нет токена; для скрипта
  // режим задаётся отдельно и по умолчанию — production.
  const env = {
    ...process.env,
    KASPI_MODE: process.env.KASPI_REGISTER_MODE ?? "production",
  };
  const config = loadKaspiConfig(env, { requireDeviceToken: false });
  if (!config) throw new Error("Kaspi выключен");
  const transport = new HttpsKaspiTransport(config);

  const flag = process.argv.indexOf("--trade-point");
  if (flag === -1) {
    const points = await call<{ TradePointId: string; TradePointName: string }[]>(
      transport,
      "GET",
      `/r3/v01/partner/tradepoints/${encodeURIComponent(config.organizationId)}`,
    );
    console.log("Торговые точки Kaspi Pay:");
    for (const p of points ?? []) {
      console.log(`  ${p.TradePointId} — ${p.TradePointName}`);
    }
    console.log(
      "\nДальше: node dist/payments/kaspi-register-device.js --trade-point <id>",
    );
    return;
  }

  const tradePoint = process.argv[flag + 1];
  if (!/^\d{1,19}$/.test(tradePoint ?? "")) {
    throw new Error("--trade-point должен быть числом из списка точек");
  }
  const data = await call<{ DeviceToken: string }>(
    transport,
    "POST",
    "/r3/v01/device/register",
    {
      OrganizationBin: config.organizationId,
      DeviceId: KASPI_DEVICE_ID,
      TradePointId: tradePoint,
    },
  );
  console.log(
    "Устройство зарегистрировано. Скопируйте значение в KASPI_DEVICE_TOKEN:",
  );
  console.log(data.DeviceToken);
}

main().catch((error) => {
  console.error(
    error instanceof KaspiApiError
      ? `Kaspi: ${error.message} (код ${error.code})`
      : String(error instanceof Error ? error.message : error),
  );
  process.exit(1);
});
