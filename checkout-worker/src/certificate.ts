import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { certificateFontBytes, supportsCertificateText } from './certificate-font';
import type { License, Payment, Snapshot } from './types';

export async function certificate(license: License): Promise<Uint8Array> {
  const snapshot = JSON.parse(license.snapshot) as Snapshot;
  const payment = JSON.parse(license.payment) as Payment;
  const sections = [
    ...(snapshot.livemode ? [] : ['TEST MODE — NO LIVE PURCHASE']),
    'iolinki software license certificate',
    `License ID: ${license.id}`,
    `Issuer: ${snapshot.issuer.name}`, snapshot.issuer.address,
    `Issuer contact: ${snapshot.issuer.email}`,
    `License holder (${snapshot.holder.kind === 'individual' ? 'named individual' : 'legal company'}): ${snapshot.holder.name}`,
    ...(snapshot.holder.kind === 'company' ? [`Company contact: ${snapshot.holder.contact}`] : []),
    `Included assistance: ${snapshot.assistance.hours} hours (${snapshot.assistance.kind})`, snapshot.assistance.scope,
    'Reproducible product bug corrections do not consume custom porting assistance hours.',
    `Purchaser: ${payment.buyerName}`, `Purchaser email: ${payment.buyerEmail}`,
    `Tier: ${snapshot.label}; developer seats: ${snapshot.seats}`,
    `Licensed version: ${snapshot.licensedVersion}`,
    'License rights and services are governed by the accepted terms below.',
    `Payment: EUR ${(payment.total / 100).toFixed(2)}; tax: EUR ${(payment.tax / 100).toFixed(2)}`,
    `Payment reference: ${payment.intentId}`,
    `Issued: ${new Date(license.issued_at).toISOString()}`,
    `Terms accepted: ${new Date(snapshot.acceptedAt).toISOString()}`,
    `Terms version: ${snapshot.terms.version}`, `Terms SHA-256: ${snapshot.terms.sha256}`,
    'This document records a software license purchase. It is not IO-Link certification or hardware validation.',
    'Accepted purchase terms', snapshot.terms.text,
  ];
  const bytes = certificateFontBytes;
  if (sections.some(section => !supportsCertificateText(section))) throw Error('unsupported certificate character');
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(bytes, {subset:true});
  pdf.setTitle('iolinki software license certificate');
  pdf.setAuthor(snapshot.issuer.name);
  pdf.setCreationDate(new Date(license.issued_at));
  pdf.setModificationDate(new Date(license.issued_at));
  let page = pdf.addPage([595,842]), y = 794;
  const size = 11, width = 499;
  const draw = (line: string) => {
    if (y < 48) { page = pdf.addPage([595,842]); y = 794; }
    page.drawText(line,{x:48,y,size,font,color:rgb(0.12,0.15,0.18)}); y -= 17;
  };
  for (const section of sections) {
    for (const paragraph of section.split(/\r?\n/)) {
      let line = '';
      for (const ch of paragraph) {
        if (font.widthOfTextAtSize(line+ch,size)>width && line) { draw(line); line=''; }
        line += ch;
      }
      if (line) draw(line);
    }
    y -= 10;
  }
  return pdf.save();
}
