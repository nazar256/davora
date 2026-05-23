const ID_KEY = "davora-browser-id";
const SECRET_KEY = "davora-browser-secret";

function createToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `davora-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function ensure(key: string): string {
  const existing = localStorage.getItem(key);
  if (existing) {
    return existing;
  }
  const created = createToken();
  localStorage.setItem(key, created);
  return created;
}

export function getBrowserIdentity() {
  return {
    browserId: ensure(ID_KEY),
    browserSecret: ensure(SECRET_KEY)
  };
}
