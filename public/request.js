// /request: shows the model field for OpenAI-style addresses, and the "Pay with my wallet" button when the browser has
// a wallet (MetaMask, Coinbase Wallet, Rabby...). The button asks our server to check the form and the price first
// (POST /request/quote, which asks the grader), then asks the wallet to send USDC on Base, then sends the form with
// the new transaction filled in. No wallet library: the wallet's own window.ethereum does the work.
(() => {
  const form = document.getElementById('request-form');
  if (!form) return;
  const $ = (id) => document.getElementById(id);
  const agent = $('rq-agent');
  const modelWrap = $('rq-model-wrap');
  const status = $('rq-status');
  const say = (text) => { status.textContent = text; };
  agent.addEventListener('input', () => {
    modelWrap.hidden = !/\/chat\/completions\/?$/.test(agent.value.trim().split(/\s+/)[0] || '');
  });

  const wallet = window.ethereum;
  if (!wallet || typeof wallet.request !== 'function') return;
  $('rq-wallet').hidden = false;
  const button = $('rq-wallet-pay');
  const BASE = '0x2105'; // chain id 8453

  // USDC's transfer(to, amount). USDC has 6 decimals.
  const transferData = (to, usd) => '0xa9059cbb' + to.toLowerCase().replace(/^0x/, '').padStart(64, '0') + BigInt(Math.round(usd * 1e6)).toString(16).padStart(64, '0');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function useBase() {
    try {
      await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE }] });
    } catch (e) {
      if (!e || e.code !== 4902) throw e;
      await wallet.request({ method: 'wallet_addEthereumChain', params: [{ chainId: BASE, chainName: 'Base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://mainnet.base.org'], blockExplorerUrls: ['https://basescan.org'] }] });
    }
  }

  function walletError(e) {
    if (e && e.code === 4001) return 'You cancelled in your wallet, so nothing was paid.';
    if (/insufficient|exceeds balance/i.test((e && e.message) || '')) return "Your wallet doesn't have enough USDC (or ETH for the network fee) on Base.";
    return e && e.message ? `Your wallet said: ${e.message}` : 'Something went wrong in your wallet.';
  }

  button.addEventListener('click', async () => {
    const payment = $('rq-payment');
    payment.required = false; // checked below, once paid
    const ok = form.reportValidity();
    payment.required = true;
    if (!ok) return;
    button.disabled = true;
    let quote;
    try {
      say('Checking your details…');
      const fields = new URLSearchParams(new FormData(form));
      fields.delete('payment');
      const res = await fetch('/request/quote', { method: 'POST', body: fields });
      quote = await res.json();
    } catch {
      quote = { error: "We couldn't reach the grader just now, so nothing was paid." };
    }
    if (!quote || quote.status !== 'ok') {
      say(quote?.error || "We couldn't check your details just now, so nothing was paid.");
      button.disabled = false;
      return;
    }
    let hash;
    try {
      say('Connecting to your wallet…');
      const accounts = await wallet.request({ method: 'eth_requestAccounts' });
      if (!accounts || !accounts[0]) throw new Error('No wallet account was shared.');
      say('Switching your wallet to Base…');
      await useBase();
      say(`Confirm the $${quote.priceUsd} USDC payment in your wallet…`);
      hash = await wallet.request({ method: 'eth_sendTransaction', params: [{ from: accounts[0], to: quote.usdc, data: transferData(quote.payTo, quote.priceUsd), value: '0x0' }] });
    } catch (e) {
      say(walletError(e));
      button.disabled = false;
      return;
    }
    // The money has moved: keep the transaction in the form so trying again never pays twice.
    payment.value = `https://basescan.org/tx/${hash}`;
    say('Paid. Waiting for Base to confirm it (a few seconds)…');
    for (let i = 0; i < 60; i++) {
      const receipt = await wallet.request({ method: 'eth_getTransactionReceipt', params: [hash] }).catch(() => null);
      if (receipt && receipt.status === '0x1') break;
      if (receipt && receipt.status === '0x0') {
        say('The payment failed on Base, so no USDC was sent.');
        button.disabled = false;
        return;
      }
      await wait(2000);
    }
    say('Confirmed. Opening your request…');
    await wait(3000); // Base's public node can lag the wallet by a few seconds
    form.submit();
  });
})();
