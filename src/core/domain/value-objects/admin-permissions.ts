export const OWNER_ADMIN_PERMISSIONS = [
  'CUSTOMERS_READ',
  'CUSTOMERS_WRITE',
  'PLANS_READ',
  'PLANS_WRITE',
  'BILLING_READ',
  'BILLING_REVIEW',
  'FINANCE_READ',
  'FINANCE_WRITE',
  'PAYMENTS_CONFIG_READ',
  'PAYMENTS_CONFIG_WRITE',
  'USERS_READ',
  'USERS_WRITE'
] as const;

export type OwnerAdminPermission = (typeof OWNER_ADMIN_PERMISSIONS)[number];
export type OwnerAdminAccessLevel = 'OWNER' | 'OPERATIONS' | 'FINANCE' | 'VIEWER' | 'CUSTOM';

const PERMISSION_SET = new Set<string>(OWNER_ADMIN_PERMISSIONS);

export const normalizeOwnerAdminPermissions = (input: unknown): OwnerAdminPermission[] => {
  const output = new Set<OwnerAdminPermission>();
  for (const value of Array.isArray(input) ? input : []) {
    const permission = String(value ?? '').trim().toUpperCase();
    if (PERMISSION_SET.has(permission)) {
      output.add(permission as OwnerAdminPermission);
    }
  }
  return Array.from(output.values());
};

export const resolveOwnerPermissionsByAccessLevel = (
  accessLevel: OwnerAdminAccessLevel,
  customPermissions?: unknown
): OwnerAdminPermission[] => {
  switch (accessLevel) {
    case 'OWNER':
      return [...OWNER_ADMIN_PERMISSIONS];
    case 'OPERATIONS':
      return [
        'CUSTOMERS_READ',
        'CUSTOMERS_WRITE',
        'PLANS_READ',
        'BILLING_READ',
        'BILLING_REVIEW',
        'FINANCE_READ',
        'PAYMENTS_CONFIG_READ'
      ];
    case 'FINANCE':
      return [
        'BILLING_READ',
        'BILLING_REVIEW',
        'FINANCE_READ',
        'FINANCE_WRITE',
        'PAYMENTS_CONFIG_READ',
        'PAYMENTS_CONFIG_WRITE'
      ];
    case 'VIEWER':
      return ['CUSTOMERS_READ', 'PLANS_READ', 'BILLING_READ', 'FINANCE_READ', 'USERS_READ'];
    case 'CUSTOM':
    default:
      return normalizeOwnerAdminPermissions(customPermissions);
  }
};

