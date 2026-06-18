export function isSafeDtfUrl(value) {
  if (typeof value !== "string") {
    return false;
  }

  let url;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  const subdomainSuffix = ".dtf.ru";
  return (
    hostname === "dtf.ru" ||
    (hostname.length > subdomainSuffix.length &&
      hostname.endsWith(subdomainSuffix))
  );
}
