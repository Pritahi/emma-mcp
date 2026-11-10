export function hasEmmaCredentials(): boolean {
  return Boolean(
    (process.env.EMMA_CLIENT_ID && process.env.EMMA_CLIENT_SECRET) ||
      process.env.EMMA_TOKEN ||
      process.env.EMMA_ACCESS_TOKEN,
  );
}

export function demoModeAllowed(): boolean {
  return process.env.EMMA_DEMO_MODE !== "false";
}
