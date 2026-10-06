/* Tipos e textos da equipe (papéis, convites, link de convite) usados pelas páginas Equipe,
 * Preferências e Login. A API é a de apps/server (docs/ARQUITETURA.md 5.3). */
import type { CreatedUser as LibCreatedUser, Invite, Role } from '../../library';

export const ROLE_LABEL: Record<Role, string> = { admin: 'Administrador', member: 'Membro', viewer: 'Leitor' };
export const ROLE_HELP: Record<Role, string> = {
  viewer: 'vê as sessões, os perfis e as análises da equipe; não envia nem muda nada',
  member: 'envia sessões, cria perfis de carro e pista e edita ou apaga o que é seu',
  admin: 'tudo, inclusive usuários, convites e o que os outros enviaram',
};
export const ROLE_OPTIONS = (['viewer', 'member', 'admin'] as Role[]).map(r => ({ value: r, label: ROLE_LABEL[r] }));

/** Convite como o servidor devolve (com situação e nomes): o tipo da biblioteca. */
export type InviteRow = Invite;

/** Usuário recém-criado: o servidor devolve a senha temporária uma única vez. */
export type CreatedUser = LibCreatedUser;

/** Link que abre o app na tela de cadastro com o código preenchido. Quando o app fala com um
 *  servidor em outro endereço (ex.: app no GitHub Pages), o link leva o endereço junto. */
export function inviteLink(code: string, baseUrl: string): string {
  const loc = window.location;
  const q = new URLSearchParams({ convite: code });
  if (baseUrl) q.set('servidor', baseUrl);
  return `${loc.origin}${loc.pathname}#/login?${q.toString()}`;
}

/** Validação simples de e-mail (a mesma ideia do servidor: algo@algo). */
export const emailOk = (e: string): boolean => /^\s*[^\s@]+@[^\s@]+\s*$/.test(e);
export const PASSWORD_MIN = 8;
