# Security policy

## Status

ClearGive is a **research prototype**. Its contracts have not been audited, and no version is deployed with real funds. The demo runs on a local, in-browser Ganache chain with a valueless demo token.

**Do not deploy these contracts with real assets.**

The demo uses Ganache's well-known deterministic test accounts. Their keys are public by design, so **never send real assets to these addresses** on any network.

## Supported versions

Only the latest commit on `main` is maintained. There are no supported production releases.

## Reporting a vulnerability

Please report suspected vulnerabilities **privately**, through GitHub's private vulnerability reporting. **Do not open a public issue, pull request or discussion.**

1. Open this repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Describe the issue. Include the affected file or contract, the steps to reproduce, and the impact you expect.

If the **Report a vulnerability** button is not shown, private reporting has not yet been enabled for this repository. In that case, open a public issue titled "Security contact request" **without any technical details**, and a maintainer will arrange a private channel.

The project has no dedicated security email address.

## Scope

In scope:

- the Solidity contracts in `contracts/`;
- the browser and worker code in `src/`;
- the build scripts.

Out of scope:

- the hosted demo website's infrastructure;
- third-party dependencies (report those upstream);
- the documented limitations in `README.md`, such as role switching without authentication, or the local chain being resettable.

This is a student project maintained on a best-effort basis. No response time or bounty is offered.
