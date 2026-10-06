/* Configuração do servidor pelas variáveis de ambiente (docs/ARQUITETURA.md 5.1).
 *
 *   PORT                 8080          porta HTTP
 *   HOST                 0.0.0.0       interface
 *   DATA_DIR             ./data        banco db.sqlite, logs em sessions/<id>.gz, segredo do JWT em secret
 *   JWT_SECRET           (arquivo)     sobrepõe o segredo gerado em DATA_DIR/secret (mínimo 32 caracteres)
 *   CORS_ORIGINS         vazio         origens permitidas, separadas por vírgula (vazio = só a mesma origem)
 *   MAX_UPLOAD_MB        100           tamanho máximo do log enviado
 *   WEB_DIST             ../web/dist   build do app servido em / (relativo a apps/server quando é o padrão)
 *   TRUST_PROXY          vazio         atrás de proxy (Cloudflare Tunnel, nginx): IP real no limite de tentativas.
 *                                      "true" = um proxy na frente; um número = quantos proxies em fila;
 *                                      ou a lista de IPs/faixas dos proxies ("127.0.0.1, 10.0.0.0/8")
 *   ANALYSIS_MEMORY_MB   1536          memória máxima (heap) da análise de um log, que roda numa thread à parte
 *   ANALYSIS_TIMEOUT_S   300           tempo máximo da análise de um log */
import { BlockList, isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ServerConfig {
  port: number;
  host: string;
  dataDir: string;
  jwtSecret?: string;
  corsOrigins: string[];
  maxUploadMb: number;
  webDist: string;
  /** false | quantos proxies na frente | lista de IPs/faixas (o `true` antigo vale 1) */
  trustProxy: boolean | number | string;
  analysisMemoryMb: number;
  analysisTimeoutS: number;
}

/* pasta do pacote (apps/server): src/ e dist/ ficam um nível abaixo */
export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const num = (v: string | undefined, def: number): number => {
  const n = v === undefined || v.trim() === '' ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
};

/** TRUST_PROXY: nunca "confiar em tudo" (com isso o primeiro endereço do X-Forwarded-For,
 *  que o cliente escreve, viraria o IP e o limite de tentativas seria contornável).
 *  "true"/"sim" = um proxy na frente (o último endereço que ele acrescentou é o cliente). */
export function parseTrustProxy(v: string | undefined): number | string | false {
  const s = (v || '').trim();
  if (!s || /^(false|no|n[aã]o|0)$/i.test(s)) return false;
  if (/^(true|yes|sim|on)$/i.test(s)) return 1;
  if (/^\d+$/.test(s)) return Number(s);
  return s;
}

/* redes que não chegam direto da internet: loopback, privadas, link-local, CGNAT (100.64/10) */
const LOCAL_NETS = new BlockList();
LOCAL_NETS.addSubnet('127.0.0.0', 8);
LOCAL_NETS.addSubnet('10.0.0.0', 8);
LOCAL_NETS.addSubnet('172.16.0.0', 12);
LOCAL_NETS.addSubnet('192.168.0.0', 16);
LOCAL_NETS.addSubnet('169.254.0.0', 16);
LOCAL_NETS.addSubnet('100.64.0.0', 10);
LOCAL_NETS.addAddress('::1', 'ipv6');
LOCAL_NETS.addSubnet('fc00::', 7, 'ipv6');
LOCAL_NETS.addSubnet('fe80::', 10, 'ipv6');

/** Endereço de rede local/privada (o proxy da frente costuma estar numa dessas). */
export function isLocalAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  const type = isIP(a);
  return type === 4 ? LOCAL_NETS.check(a, 'ipv4') : type === 6 ? LOCAL_NETS.check(a, 'ipv6') : false;
}

/** Opção trustProxy do Fastify a partir do TRUST_PROXY. Contagem de proxies ("true" = 1):
 *  confia em até N saltos do X-Forwarded-For, e o primeiro (quem conectou no servidor) só se
 *  vier de rede local. Assim, mesmo com TRUST_PROXY ligado por engano num servidor exposto,
 *  quem conecta direto da internet não escolhe o próprio IP. Lista de IPs/faixas: como está. */
export function trustProxyOption(v: ServerConfig['trustProxy']): false | string | ((addr: string, hop: number) => boolean) {
  if (v === false || v === 0 || v === '') return false;
  const hops = v === true ? 1 : v;
  if (typeof hops === 'number') return (addr, hop) => hop < hops && (hop > 0 || isLocalAddress(addr));
  return hops;
}

/** Lê a configuração do ambiente (padrões da tabela acima). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: num(env.PORT, 8080),
    host: env.HOST?.trim() || '0.0.0.0',
    dataDir: path.resolve(env.DATA_DIR?.trim() || './data'),
    jwtSecret: env.JWT_SECRET?.trim() || undefined,
    corsOrigins: (env.CORS_ORIGINS || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean),
    maxUploadMb: num(env.MAX_UPLOAD_MB, 100),
    webDist: env.WEB_DIST?.trim() ? path.resolve(env.WEB_DIST.trim()) : path.resolve(SERVER_ROOT, '../web/dist'),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    analysisMemoryMb: num(env.ANALYSIS_MEMORY_MB, 1536),
    analysisTimeoutS: num(env.ANALYSIS_TIMEOUT_S, 300),
  };
}
