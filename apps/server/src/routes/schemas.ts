/* Pedaços de JSON Schema reaproveitados pelas rotas. */
export const ROLE = { type: 'string', enum: ['viewer', 'member', 'admin'] } as const;
export const EMAIL = { type: 'string', minLength: 3, maxLength: 200, pattern: '^\\s*[^\\s@]+@[^\\s@]+\\s*$' } as const;
export const PASSWORD = { type: 'string', minLength: 8, maxLength: 200 } as const;
export const NAME = { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' } as const;
export const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' } as const;
export const ID_PARAMS = {
  type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID },
} as const;
