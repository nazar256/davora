export const assertNever = (value: never, context: string): never => {
  const rendered = JSON.stringify(value) ?? String(value);
  throw new Error(`Unexpected value in ${context}: ${rendered}`);
};
