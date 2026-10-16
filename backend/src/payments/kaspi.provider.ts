import { Injectable } from "@nestjs/common";
import { X509Certificate } from "node:crypto";
import { request as httpsRequest, RequestOptions } from "node:https";
import { rootCertificates } from "node:tls";
import {
  CreateProviderPaymentRequest,
  CreatedProviderPayment,
  PaymentProvider,
  ProviderPaymentState,
  RefundedProviderPayment,
  RefundProviderPaymentRequest,
} from "./payment-provider";

export type KaspiMode = "disabled" | "test" | "production";

export interface KaspiConfig {
  mode: Exclude<KaspiMode, "disabled">;
  baseUrl: URL;
  pfx?: Buffer;
  privateKey?: Buffer;
  clientCertificate?: Buffer;
  passphrase: string;
  ca: Buffer[];
  organizationId: string;
  deviceToken: string;
  timeoutMs: number;
}

type JsonObject = Record<string, unknown>;

export interface KaspiTransport {
  request<T>(
    method: "GET" | "POST",
    path: string,
    requestId: string,
    body?: JsonObject,
  ): Promise<T>;
}

interface KaspiEnvelope<T> {
  StatusCode: number | string;
  Message?: string;
  Data?: T;
}

interface CreatePaymentData {
  QrToken?: string;
  PaymentLink?: string;
  ExpireDate: string;
  QrPaymentId?: string;
  PaymentId?: string;
  PaymentMethods?: string[];
  QrPaymentBehaviorOptions?: PaymentBehaviorOptions;
  PaymentBehaviorOptions?: PaymentBehaviorOptions;
}

interface PaymentBehaviorOptions {
  StatusPollingInterval?: number;
  QrCodeScanWaitTimeout?: number;
  LinkActivationWaitTimeout?: number;
  PaymentConfirmationTimeout?: number;
}

interface PaymentStatusData {
  Status?: string;
  TransactionId?: string;
}

interface RefundData {
  ReturnOperationId?: string;
}

const INT64_FIELDS = ["QrPaymentId", "PaymentId", "ReturnOperationId"];

/**
 * Ошибка API Kaspi с признаком, можно ли безопасно повторить запрос.
 * Постоянные ошибки конфигурации и валидации не должны создавать лавину
 * повторов возврата; сетевые/серверные ошибки и -99000006 повторяются.
 */
export class KaspiApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "KaspiApiError";
  }
}

export function kaspiMode(env: NodeJS.ProcessEnv = process.env): KaspiMode {
  const raw = (env.KASPI_MODE ?? "disabled").trim().toLowerCase();
  if (raw === "disabled" || raw === "test" || raw === "production") return raw;
  throw new Error("KASPI_MODE должен быть disabled, test или production");
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Не задана обязательная переменная ${name}`);
  return value;
}

function decodeBase64(env: NodeJS.ProcessEnv, name: string): Buffer {
  const value = required(env, name);
  const buffer = Buffer.from(value, "base64");
  if (buffer.length === 0) throw new Error(`${name} не содержит данных`);
  return buffer;
}

function decodeCa(env: NodeJS.ProcessEnv, name: string): Buffer {
  const buffer = decodeBase64(env, name);
  if (buffer.toString("ascii", 0, 40).includes("BEGIN CERTIFICATE")) {
    return buffer;
  }
  try {
    // Тестовый архив Kaspi хранит .crt в DER, а node:tls принимает CA в PEM.
    return Buffer.from(new X509Certificate(buffer).toString());
  } catch {
    throw new Error(`${name} не содержит корректный X.509 сертификат`);
  }
}

export function loadKaspiConfig(
  env: NodeJS.ProcessEnv = process.env,
): KaspiConfig | null {
  const mode = kaspiMode(env);
  if (mode === "disabled") return null;

  const baseUrl = new URL(required(env, "KASPI_BASE_URL"));
  if (baseUrl.protocol !== "https:") {
    throw new Error("KASPI_BASE_URL должен использовать HTTPS");
  }
  if (baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash) {
    throw new Error("KASPI_BASE_URL должен содержать только origin без пути");
  }
  const isTestHost = baseUrl.hostname === "mtokentest.kaspi.kz";
  if (mode === "test" && (!isTestHost || baseUrl.port !== "8545")) {
    throw new Error(
      "KASPI_MODE=test разрешает только https://mtokentest.kaspi.kz:8545",
    );
  }
  if (mode === "production" && isTestHost) {
    throw new Error(
      "KASPI_MODE=production не может использовать тестовый хост",
    );
  }

  const timeoutRaw = Number(env.KASPI_TIMEOUT_MS ?? 15_000);
  if (
    !Number.isFinite(timeoutRaw) ||
    timeoutRaw < 1_000 ||
    timeoutRaw > 60_000
  ) {
    throw new Error("KASPI_TIMEOUT_MS должен быть от 1000 до 60000");
  }

  const pfxValue = env.KASPI_CERT_P12_BASE64?.trim();
  const privateKeyValue = env.KASPI_PRIVATE_KEY_BASE64?.trim();
  const clientCertificateValue = env.KASPI_CLIENT_CERT_BASE64?.trim();
  if (!pfxValue && !(privateKeyValue && clientCertificateValue)) {
    throw new Error(
      "Задайте KASPI_CERT_P12_BASE64 либо пару KASPI_PRIVATE_KEY_BASE64 + KASPI_CLIENT_CERT_BASE64",
    );
  }

  return {
    mode,
    baseUrl,
    pfx: pfxValue ? decodeBase64(env, "KASPI_CERT_P12_BASE64") : undefined,
    privateKey: privateKeyValue
      ? decodeBase64(env, "KASPI_PRIVATE_KEY_BASE64")
      : undefined,
    clientCertificate: clientCertificateValue
      ? decodeCa(env, "KASPI_CLIENT_CERT_BASE64")
      : undefined,
    passphrase: required(env, "KASPI_CERT_PASSWORD"),
    ca: [
      decodeCa(env, "KASPI_ROOT_CA_BASE64"),
      decodeCa(env, "KASPI_INTERMEDIATE_CA_BASE64"),
    ],
    organizationId: required(env, "KASPI_ORGANIZATION_ID"),
    deviceToken: required(env, "KASPI_DEVICE_TOKEN"),
    timeoutMs: timeoutRaw,
  };
}

function assertAmount(amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new KaspiApiError(
      "Сумма Kaspi должна быть положительным целым количеством тенге",
      "INVALID_AMOUNT",
      false,
    );
  }
}

function assertInt64(value: string, field: string) {
  if (!/^\d{1,19}$/.test(value)) {
    throw new KaspiApiError(
      `${field} должен быть положительным Int64`,
      "INVALID_PROVIDER_ID",
      false,
    );
  }
}

/**
 * JSON.parse превращает Int64 Kaspi в неточный JavaScript Number. Перед
 * разбором заключаем известные идентификаторы в кавычки, сохраняя все цифры.
 */
export function parseKaspiJson(text: string): unknown {
  const safe = text.replace(
    /"(QrPaymentId|PaymentId|ReturnOperationId)"\s*:\s*(-?\d+)/g,
    '"$1":"$2"',
  );
  return JSON.parse(safe);
}

/** Kaspi ожидает QrPaymentId числом; строка используется только локально. */
export function serializeKaspiBody(body: JsonObject): string {
  let json = JSON.stringify(body);
  for (const field of INT64_FIELDS) {
    const value = body[field];
    if (typeof value !== "string") continue;
    assertInt64(value, field);
    json = json.replace(`"${field}":"${value}"`, `"${field}":${value}`);
  }
  return json;
}

function isRetryableCode(code: string) {
  return code === "-999" || code === "-99000006";
}

export class HttpsKaspiTransport implements KaspiTransport {
  constructor(private readonly config: KaspiConfig) {}

  request<T>(
    method: "GET" | "POST",
    path: string,
    requestId: string,
    body?: JsonObject,
  ): Promise<T> {
    const url = new URL(path, this.config.baseUrl);
    if (url.origin !== this.config.baseUrl.origin) {
      throw new KaspiApiError(
        "Запрос Kaspi вышел за пределы настроенного API",
        "INVALID_URL",
        false,
      );
    }
    const payload = body ? serializeKaspiBody(body) : undefined;
    const options: RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      // Тестовый gateway Kaspi закрывает TLS-сокет после ответа, но не
      // всегда помечает это корректно. Повторное использование соединения
      // в Node 19+ приводило к `socket hang up` на следующем POST.
      agent: false,
      ...(this.config.pfx
        ? { pfx: this.config.pfx }
        : {
            key: this.config.privateKey,
            cert: this.config.clientCertificate,
          }),
      passphrase: this.config.passphrase,
      // Переданный `ca` заменяет системное хранилище Node целиком. Сервер
      // Kaspi использует публичную цепочку, а клиентский комплект — свою,
      // поэтому доверяем обеим цепочкам одновременно.
      ca: [...rootCertificates, ...this.config.ca],
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Request-ID": requestId,
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    };

    return new Promise<T>((resolve, reject) => {
      const req = httpsRequest(options, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1024 * 1024) {
            req.destroy(
              new KaspiApiError(
                "Ответ Kaspi превышает допустимый размер",
                "RESPONSE_TOO_LARGE",
                false,
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          const text = Buffer.concat(chunks).toString("utf8");
          if (status < 200 || status >= 300) {
            reject(
              new KaspiApiError(
                `Kaspi API ответил HTTP ${status}`,
                `HTTP_${status}`,
                status === 429 || status >= 500,
              ),
            );
            return;
          }
          try {
            resolve(parseKaspiJson(text) as T);
          } catch {
            reject(
              new KaspiApiError(
                "Kaspi API вернул некорректный JSON",
                "INVALID_JSON",
                false,
              ),
            );
          }
        });
      });
      req.setTimeout(this.config.timeoutMs, () => {
        req.destroy(
          new KaspiApiError("Таймаут соединения с Kaspi", "TIMEOUT", true),
        );
      });
      req.on("error", (error) => {
        reject(
          error instanceof KaspiApiError
            ? error
            : new KaspiApiError(
                `Ошибка соединения с Kaspi: ${error.message}`,
                "NETWORK_ERROR",
                true,
              ),
        );
      });
      if (payload) req.write(payload);
      req.end();
    });
  }
}

export class KaspiProviderCore implements PaymentProvider {
  constructor(
    private readonly config: KaspiConfig,
    private readonly transport: KaspiTransport = new HttpsKaspiTransport(
      config,
    ),
  ) {}

  async createPayment(
    request: CreateProviderPaymentRequest,
  ): Promise<CreatedProviderPayment> {
    assertAmount(request.amount);
    const mobile = request.channel === "MOBILE_LINK";
    const path = mobile ? "/r3/v01/qr/create-link" : "/r3/v01/qr/create";
    const envelope = await this.call<CreatePaymentData>(
      "POST",
      path,
      request.requestId,
      {
        OrganizationBin: this.config.organizationId,
        DeviceToken: this.config.deviceToken,
        Amount: request.amount,
        ExternalId: request.externalId,
      },
    );
    const data = envelope.Data;
    const providerPaymentId = data?.QrPaymentId ?? data?.PaymentId;
    const behavior =
      data?.QrPaymentBehaviorOptions ?? data?.PaymentBehaviorOptions;
    if (!data || !providerPaymentId || !behavior) {
      throw new KaspiApiError(
        "Kaspi не вернул обязательные данные платежа",
        "INVALID_RESPONSE",
        false,
      );
    }
    assertInt64(providerPaymentId, "PaymentId");
    const expiresAt = new Date(data.ExpireDate);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new KaspiApiError(
        "Kaspi вернул некорректный срок платежа",
        "INVALID_RESPONSE",
        false,
      );
    }

    return {
      providerPaymentId,
      status: "QR_TOKEN_CREATED",
      expiresAt,
      paymentMethods: data.PaymentMethods ?? [],
      statusPollingIntervalSec: behavior.StatusPollingInterval ?? 5,
      activationTimeoutSec:
        (mobile
          ? behavior.LinkActivationWaitTimeout
          : behavior.QrCodeScanWaitTimeout) ?? 180,
      confirmationTimeoutSec: behavior.PaymentConfirmationTimeout ?? 65,
      paymentLink: data.PaymentLink,
      qrToken: data.QrToken,
    };
  }

  async getPaymentStatus(
    providerPaymentId: string,
    requestId: string,
  ): Promise<ProviderPaymentState> {
    assertInt64(providerPaymentId, "QrPaymentId");
    const envelope = await this.call<PaymentStatusData>(
      "GET",
      `/r3/v02/payment/status/${providerPaymentId}`,
      requestId,
    );
    const status = envelope.Data?.Status;
    switch (status) {
      case "QrTokenCreated":
        return { status: "QR_TOKEN_CREATED" };
      case "Wait":
        return { status: "WAIT" };
      case "Processed":
        return {
          status: "PROCESSED",
          transactionId: envelope.Data?.TransactionId,
        };
      case "Error":
        return {
          status: "ERROR",
          errorCode: "PAYMENT_ERROR",
          errorMessage: envelope.Message ?? "Kaspi отклонил платёж",
        };
      default:
        return {
          status: "ERROR",
          errorCode: "UNKNOWN_STATUS",
          errorMessage: `Неизвестный статус Kaspi: ${String(status)}`,
        };
    }
  }

  async refundPayment(
    request: RefundProviderPaymentRequest,
  ): Promise<RefundedProviderPayment> {
    assertAmount(request.amount);
    assertInt64(request.providerPaymentId, "QrPaymentId");
    const envelope = await this.call<RefundData>(
      "POST",
      "/r3/v01/payment/return",
      request.requestId,
      {
        DeviceToken: this.config.deviceToken,
        QrPaymentId: request.providerPaymentId,
        Amount: request.amount,
        OrganizationBin: this.config.organizationId,
      },
    );
    const providerRefundId = envelope.Data?.ReturnOperationId;
    if (!providerRefundId) {
      throw new KaspiApiError(
        "Kaspi не вернул идентификатор возврата",
        "INVALID_RESPONSE",
        false,
      );
    }
    assertInt64(providerRefundId, "ReturnOperationId");
    return { providerRefundId };
  }

  private async call<T>(
    method: "GET" | "POST",
    path: string,
    requestId: string,
    body?: JsonObject,
  ) {
    const envelope = await this.transport.request<KaspiEnvelope<T>>(
      method,
      path,
      requestId,
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
    return envelope;
  }
}

@Injectable()
export class KaspiProvider implements PaymentProvider {
  private readonly core: KaspiProviderCore;

  constructor() {
    const config = loadKaspiConfig();
    if (!config) {
      throw new Error("KaspiProvider создан при KASPI_MODE=disabled");
    }
    this.core = new KaspiProviderCore(config);
  }

  createPayment(request: CreateProviderPaymentRequest) {
    return this.core.createPayment(request);
  }

  getPaymentStatus(providerPaymentId: string, requestId: string) {
    return this.core.getPaymentStatus(providerPaymentId, requestId);
  }

  refundPayment(request: RefundProviderPaymentRequest) {
    return this.core.refundPayment(request);
  }
}
