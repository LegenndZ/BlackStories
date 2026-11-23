/**
 * Vercel Serverless Function: /api/verificar-wompi
 * Verifica directamente con la API oficial de Wompi si una transacción (?id=...)
 * fue APROBADA y cumple el monto mínimo de donación en COP para entregar la clave del Nivel 3.
 *
 * Variables de entorno requeridas en Vercel:
 *  - NIVEL3_CLAVE     : Clave secreta de acceso al Nivel 3 (obligatoria en producción)
 *  - WOMPI_MIN_COP    : Monto mínimo en pesos colombianos (opcional, por defecto 20000)
 *  - WOMPI_ENV        : 'production' (por defecto) o 'sandbox'
 */

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método no permitido. Usa GET.' });
  }

  const rawId = typeof req.query?.id === 'string' ? req.query.id.trim() : '';
  if (!rawId || !/^[a-zA-Z0-9_-]{4,100}$/.test(rawId)) {
    return res.status(400).json({ ok: false, error: 'ID de transacción inválido.' });
  }

  const isSandbox = String(process.env.WOMPI_ENV || '').toLowerCase() === 'sandbox';
  const wompiBaseUrl = isSandbox
    ? 'https://sandbox.wompi.co/v1/transactions/'
    : 'https://production.wompi.co/v1/transactions/';

  const minCop = Math.max(1000, Number(process.env.WOMPI_MIN_COP) || 20000);
  const minAmountInCents = minCop * 100;

  try {
    const wompiResp = await fetch(`${wompiBaseUrl}${encodeURIComponent(rawId)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });

    if (wompiResp.status === 404) {
      return res.status(404).json({
        ok: false,
        approved: false,
        status: 'NOT_FOUND',
        error: 'No encontramos esa transacción en Wompi.'
      });
    }

    if (!wompiResp.ok) {
      return res.status(502).json({
        ok: false,
        approved: false,
        status: 'UPSTREAM_ERROR',
        error: 'No se pudo consultar Wompi en este momento. Intenta de nuevo en unos segundos.'
      });
    }

    const payload = await wompiResp.json();
    const tx = payload?.data;

    if (!tx || typeof tx !== 'object') {
      return res.status(502).json({
        ok: false,
        approved: false,
        status: 'INVALID_RESPONSE',
        error: 'Respuesta inesperada de Wompi.'
      });
    }

    const status = String(tx.status || 'UNKNOWN').toUpperCase();
    const currency = String(tx.currency || 'COP').toUpperCase();
    const amountInCents = Number(tx.amount_in_cents) || 0;
    const amountCop = Math.round(amountInCents / 100);
    const reference = String(tx.reference || '');

    const isApproved = status === 'APPROVED';
    const meetsMinimum = currency === 'COP' && amountInCents >= minAmountInCents;

    if (isApproved && meetsMinimum) {
      const accessCode = process.env.NIVEL3_CLAVE ? String(process.env.NIVEL3_CLAVE).trim() : '';

      if (!accessCode) {
        return res.status(500).json({
          ok: false,
          approved: true,
          meetsMinimum: true,
          status,
          amountCop,
          currency,
          reference,
          missingConfig: true,
          error: 'Pago aprobado, pero falta configurar la variable NIVEL3_CLAVE en Vercel.'
        });
      }

      return res.status(200).json({
        ok: true,
        approved: true,
        meetsMinimum: true,
        status,
        amountCop,
        minCop,
        currency,
        reference,
        accessCode
      });
    }

    return res.status(200).json({
      ok: true,
      approved: isApproved,
      meetsMinimum,
      status,
      amountCop,
      minCop,
      currency,
      reference,
      accessCode: null
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      approved: false,
      status: 'SERVER_ERROR',
      error: 'Error interno al verificar la transacción con Wompi.'
    });
  }
};
