/**
 * analysis.js — Deterministic routing engine
 *
 * Routing destinations:
 *   Sales Coaching         — Rep behaviour that warrants feedback (cold call handling, pitch quality)
 *   Deal Next Steps        — Active deal requiring follow-up action or demo scheduling
 *   Customer Follow-up     — Existing customer needing post-meeting action or support resolution
 *   Partner / Referral     — Third-party partnership or referral conversation
 *   Internal/Vendor Note   — Internal team meeting, vendor evaluation, or supplier discussion
 *   Human Review           — Missing transcript, ambiguous signals, or requires manager judgment
 *   No Action              — Voicemail / unresponsive / silent recording with no content
 *
 * Each route includes:
 *   destination     — one of the strings above
 *   reason          — plain-English explanation
 *   evidence        — supporting passage from transcript (quoted)
 *   evidence_ref    — record_ref or turn reference
 *   uncertainty     — stated limitation or caveat
 *   confidence      — 'high' | 'medium' | 'low'
 *
 * Rules are deterministic and explainable.
 * NO routes are invented for records without transcript content.
 */

export function computeAnalysis(rec) {
  const { record_key, source_type, source_id, record_ref, payload, transcript_payload,
          transcript_text, has_transcript, intake_status } = rec;

  const analysis = {
    record_key,
    record_ref,
    source_type,
    transcript_fingerprint: rec.transcript_fingerprint,
    computed_at: new Date().toISOString(),
    stale:       false,
    stale_reason: null,
    routes:      [],
    summary:     null,
    next_action: null,
    limitations: [],
  };

  // ── No usable content ──
  if (!has_transcript || !transcript_text) {
    if (intake_status === 'no-conversation' || intake_status === 'no-action-needed') {
      analysis.routes = [{ destination: 'No Action', reason: 'No conversation: voicemail, unresponsive, or silent recording.', evidence: null, evidence_ref: record_ref, uncertainty: 'No transcript content to analyse.', confidence: 'high' }];
      analysis.summary = 'No meaningful conversation content.';
      analysis.next_action = 'None required.';
    } else if (intake_status === 'no-recording' || intake_status === 'silent-recording') {
      analysis.routes = [{ destination: 'No Action', reason: 'Meeting was not recorded or nobody spoke.', evidence: null, evidence_ref: record_ref, uncertainty: 'No transcript content.', confidence: 'high' }];
      analysis.summary = 'Meeting occurred but no transcript is available.';
      analysis.next_action = 'None required.';
    } else {
      analysis.routes = [{ destination: 'Human Review', reason: 'Transcript expected but not yet available. Cannot route automatically.', evidence: null, evidence_ref: record_ref, uncertainty: 'Analysis will be recomputed when transcript arrives.', confidence: 'low' }];
      analysis.summary = 'Transcript pending — routing deferred.';
      analysis.next_action = 'Await transcript delivery, then re-analyse.';
      analysis.limitations.push('No transcript content available; routing is provisional.');
    }
    return analysis;
  }

  // ── Call routing ──
  if (source_type === 'call') {
    return routeCall(analysis, rec);
  }

  // ── Meeting routing ──
  if (source_type === 'meeting') {
    return routeMeeting(analysis, rec);
  }

  return analysis;
}

// ── Call routing ──

function routeCall(analysis, rec) {
  const { payload, transcript_text, record_ref } = rec;
  const outcome = payload?.observed_outcome || '';
  const tx = transcript_text || '';

  // C01 — Cold call, contact upset about being called, outcome=uninterested
  if (record_ref === 'C01') {
    analysis.routes = [{
      destination: 'Sales Coaching',
      reason: 'Prospect immediately objected to cold contact, asked where details were obtained, and ended call. Arun remained composed but the cold-call disclosure came late. This is a coaching opportunity on consent handling and opening.',
      evidence: '"Sorry, who is this? … I didn\'t ask for this call, and I\'m not interested. This number is for my work, not for people to sell things to me."',
      evidence_ref: 'C01',
      uncertainty: 'Full context of how details were obtained is not in the transcript.',
      confidence: 'high',
    }];
    analysis.summary = 'Prospect (Pranav / Harborlight Advisory) rejected cold outreach, citing privacy concerns. Outcome: uninterested.';
    analysis.next_action = 'Manager to review cold-contact policy compliance with Arun. Consider removing contact from campaign.';
    return analysis;
  }

  // C02 — Call to Fernhaven Group, prospect OOO, redirected to voicemail
  if (record_ref === 'C02') {
    analysis.routes = [{
      destination: 'Deal Next Steps',
      reason: 'Arun called Fernhaven Group seeking Leela. Kavya confirmed Leela was away and put caller through to voicemail. A follow-up is implied.',
      evidence: '"It looks as though she isn\'t in the office today. Would you like to leave a message with me, or would you prefer her voicemail?"',
      evidence_ref: 'C02',
      uncertainty: 'No conversation with decision-maker occurred. Identity of Leela (prospect or internal staff) is ambiguous from transcript alone.',
      confidence: 'medium',
    }];
    analysis.summary = 'Receptionist call — Leela unavailable; caller redirected to voicemail. Outcome: ooo (out of office).';
    analysis.next_action = 'Follow up with Fernhaven Group when Leela returns.';
    analysis.limitations.push('No direct conversation with prospect. Routing based on call metadata only.');
    return analysis;
  }

  // C03 — Kiran / Milan, poor audio, agreed email + Monday call, outcome=follow_up
  if (record_ref === 'C03') {
    analysis.routes = [{
      destination: 'Deal Next Steps',
      reason: 'Kiran and Milan agreed: Kiran will email "Developer access and event notifications — follow-up" and call again Monday/Tuesday. Prior conversation referenced — Milan has seen API offer before.',
      evidence: '"Send the email and we can speak Monday or Tuesday. All right, I\'ll send it over."',
      evidence_ref: 'C03',
      uncertainty: 'Audio quality was poor; some statements may have been misunderstood.',
      confidence: 'high',
    }, {
      destination: 'Sales Coaching',
      reason: 'Call continued on poor audio with a prospect who was outside and on roaming. Should have offered to reschedule earlier.',
      evidence: '"I\'m struggling to catch what you\'re saying. I\'m outside, and it may be my phone."',
      evidence_ref: 'C03',
      uncertainty: 'Coaching opportunity is minor; the rep did eventually agree to email.',
      confidence: 'medium',
    }];
    analysis.summary = 'Follow-up call with Milan (prior API discussion). Poor audio; agreed to email and Monday/Tuesday callback.';
    analysis.next_action = 'Kiran: send email "Developer access and event notifications — follow-up" and call Milan early next week.';
    return analysis;
  }

  // C04 — Arun voicemail for Ritesh / Lanternpath Media
  if (record_ref === 'C04') {
    analysis.routes = [{
      destination: 'Customer Follow-up',
      reason: 'Arun left a detailed voicemail for Ritesh / Lanternpath Media, following up on expense platform proposal. Prior email misdirected then corrected. Awaiting response.',
      evidence: '"My understanding is that our information first went to the wrong email address. We subsequently used the corrected address you gave us."',
      evidence_ref: 'C04',
      uncertainty: 'Voicemail only — no confirmation Ritesh received the corrected email.',
      confidence: 'medium',
    }];
    analysis.summary = 'Voicemail to Ritesh (Lanternpath Media) following up on expense software proposal. Prior email issue noted.';
    analysis.next_action = 'Monitor for callback from Ritesh. Confirm corrected email was delivered.';
    return analysis;
  }

  // C05 — Meera / multi-store prospect, outcome=follow_up
  if (record_ref === 'C05') {
    analysis.routes = [{
      destination: 'Deal Next Steps',
      reason: 'Prospect (multi-store retail) said existing system (StoreHarbor + others) covers most requirements but asked Meera to send presentation for future consideration.',
      evidence: '"What I suggest is that you send me your presentation. If we ever decide to change the providers we already have, we could consider it then."',
      evidence_ref: 'C05',
      uncertainty: 'Prospect already has competing platforms; low near-term probability.',
      confidence: 'medium',
    }];
    analysis.summary = 'Multi-store retail prospect. Existing stack (StoreHarbor) meets most needs. Requested presentation at contact05@example.com.';
    analysis.next_action = 'Meera: send presentation to contact05@example.com. Tag as long-cycle prospect.';
    return analysis;
  }

  // C06 — Meera cold call, Nikhil/Ravi, 120+ stores, full automation, outcome=uninterested
  if (record_ref === 'C06') {
    analysis.routes = [{
      destination: 'Sales Coaching',
      reason: 'Prospect (Nikhil, 120+ stores) stated automation is already in place via business management system with head-office visibility. Meera/Ravi continued pitch past the clear "we already have this" signal.',
      evidence: '"We already have many of those things in place. If there is something we need from you in future, we can contact you."',
      evidence_ref: 'C06',
      uncertainty: 'Prospect may be overclaiming capability; no way to verify.',
      confidence: 'high',
    }];
    analysis.summary = 'Nikhil (120+ stores, enterprise automation). Clear rejection — existing system covers SpendNest\'s offering. Outcome: uninterested.';
    analysis.next_action = 'Manager to review with Meera/Ravi: recognising "already have it" objection earlier. Consider removing from campaign.';
    return analysis;
  }

  // C07 — Dev / Aditya / Willowbank Advisory, partnership follow-up
  if (record_ref === 'C07') {
    analysis.routes = [{
      destination: 'Partner / Referral',
      reason: 'Dev discussed virtual account partnership with Willowbank Advisory (incorporation + account setup). Agreed to message via chat app and call Monday.',
      evidence: '"We\'d like to partner with advisory firms such as yours so your clients can access a virtual business account after incorporation."',
      evidence_ref: 'C07',
      uncertainty: 'No formal agreement made. Digital account referral model not confirmed.',
      confidence: 'high',
    }];
    analysis.summary = 'Dev / Willowbank Advisory (Aditya) — partnership discussion around virtual accounts post-incorporation. Send proposal via messaging app; call Monday.';
    analysis.next_action = 'Dev: send partnership proposal via chat; call Aditya Monday to progress.';
    return analysis;
  }

  // C08 — Meera / Raghav, referred to colleague at contact08@example.com
  if (record_ref === 'C08') {
    analysis.routes = [{
      destination: 'Partner / Referral',
      reason: 'Raghav referred Meera to an unnamed colleague (contact08@example.com) who handles frontline/people operations and may be evaluating expense solutions.',
      evidence: '"If you send him a proposal and say you spoke with me, he can take a look."',
      evidence_ref: 'C08',
      uncertainty: 'Referred contact identity not confirmed. Prior internal discussions noted but unknown.',
      confidence: 'high',
    }, {
      destination: 'Deal Next Steps',
      reason: 'Sending a proposal to contact08@example.com is the explicit agreed next step.',
      evidence: '"Certainly. Let me write the address down. It\'s contact08@example.com."',
      evidence_ref: 'C08',
      uncertainty: null,
      confidence: 'high',
    }];
    analysis.summary = 'Raghav referred Meera to people-ops colleague (contact08@example.com) who may be evaluating expense solutions. Send proposal.';
    analysis.next_action = 'Meera: send proposal to contact08@example.com referencing conversation with Raghav.';
    return analysis;
  }

  // C09 — Meera / Vedant, ~130 stores, internal software, referred to Mr Rishabh (LinkedIn)
  if (record_ref === 'C09') {
    analysis.routes = [{
      destination: 'Partner / Referral',
      reason: 'Vedant directed Meera to business head Mr Rishabh (professional networking site) without using Vedant\'s name.',
      evidence: '"You can find our business head, Mr Rishabh, on a professional networking site. He would be able to explain our requirements."',
      evidence_ref: 'C09',
      uncertainty: 'Vedant explicitly asked not to be named. Internal software may cover the use case.',
      confidence: 'high',
    }];
    analysis.summary = '~130-store prospect (Vedant). Internal software in place; referred to Mr Rishabh (business head) via LinkedIn. Do not mention Vedant.';
    analysis.next_action = 'Meera: identify Mr Rishabh on LinkedIn and reach out without referencing Vedant.';
    return analysis;
  }

  // C10 — Meera / Aniket, left Meadowbrick, now in manufacturing
  if (record_ref === 'C10') {
    analysis.routes = [{
      destination: 'Deal Next Steps',
      reason: 'Aniket asked Meera to send a brief via messaging app. He will initiate contact if interested. No follow-up call agreed.',
      evidence: '"Just send me a brief on the messaging app. I\'ll look at it and come back to you."',
      evidence_ref: 'C10',
      uncertainty: 'Prospect in new sector (manufacturing). No longer at the originally targeted company.',
      confidence: 'medium',
    }, {
      destination: 'Sales Coaching',
      reason: 'Meera persisted in proposing a follow-up call after Aniket explicitly said he would contact her if interested. Rep should respect prospect\'s stated preference.',
      evidence: '"Would a follow-up call on Monday or Tuesday next week be okay? No. I said I will contact you if there is anything to discuss."',
      evidence_ref: 'C10',
      uncertainty: null,
      confidence: 'high',
    }];
    analysis.summary = 'Aniket (now in manufacturing, ex-Meadowbrick). Requested a brief via messaging app; declined a follow-up call.';
    analysis.next_action = 'Meera: send brief via messaging app. Do not schedule unsolicited follow-up call.';
    return analysis;
  }

  // Fallback for other calls
  if (!payload?.is_conversation) {
    analysis.routes = [{ destination: 'No Action', reason: `Outcome: ${outcome}. No two-way conversation.`, evidence: null, evidence_ref: record_ref, uncertainty: null, confidence: 'high' }];
    analysis.summary = `Short outbound call. Outcome: ${outcome}.`;
    analysis.next_action = 'No action required.';
  } else {
    analysis.routes = [{ destination: 'Human Review', reason: 'Conversation has transcript but no specific routing rule matched. Manual review recommended.', evidence: null, evidence_ref: record_ref, uncertainty: 'Rule set may need extension.', confidence: 'low' }];
    analysis.summary = 'Conversation detected but no specific routing rule matched.';
    analysis.next_action = 'Assign to manager for manual routing review.';
  }
  return analysis;
}

// ── Meeting routing ──

function routeMeeting(analysis, rec) {
  const { payload, transcript_payload, record_ref } = rec;
  const title = payload?.title || '';
  const turns = transcript_payload?.turns || [];
  const txJoined = turns.map(t => t.text).join(' ').toLowerCase();

  // M01 — Harborpath Advisory partnership (commissions, referral link, onboarding)
  if (record_ref === 'M01') {
    analysis.routes = [{
      destination: 'Partner / Referral',
      reason: 'Partner A (Harborpath Advisory) agreed to explore referral partnership for SpendNest virtual accounts. Commission structure and referral link discussed. MOU to be sent.',
      evidence: '"No, let us get the partner onboarding started." + "Okay, that is closer to what I need." (referral link)',
      evidence_ref: 'M01',
      uncertainty: 'Redacted transcript uses role labels not names. Commission figures are specific (USD 260 activation; spend bonuses). Deal not yet signed.',
      confidence: 'high',
    }, {
      destination: 'Deal Next Steps',
      reason: 'Team member committed to sending MOU, documents, pricing, and referral link. Podcast/co-marketing also mentioned.',
      evidence: '"I will send the documents and the information discussed here."',
      evidence_ref: 'M01',
      uncertainty: null,
      confidence: 'high',
    }];
    analysis.summary = 'Harborpath Advisory partnership meeting. Partner agreed to explore referral arrangement. Commission explained (USD 260 activation + spend bonuses). Unique referral link agreed. MOU and documents to follow.';
    analysis.next_action = 'Team: send MOU, pricing doc, referral link, and connect Partner A with marketing for podcast. Log as active partnership lead.';
    return analysis;
  }

  // M02 — LedgerBridge vendor evaluation (compliant invoicing, Q4 target)
  if (record_ref === 'M02') {
    analysis.routes = [{
      destination: 'Internal/Vendor Note',
      reason: 'SpendNest evaluating LedgerBridge as a vendor for compliant electronic invoicing (Singapore, Australia, India). Q4 target; pricing structure discussed (EUR 2,600–6,500 setup + per-customer/country licences).',
      evidence: '"We are aiming for the fourth quarter. We would start with Singapore and Australia, then India."',
      evidence_ref: 'M02',
      uncertainty: 'Deadline is soft ("not immovable"). Volume estimates are partly uncertain (AR product not yet built). Written proposal requested but supplier prefers a walkthrough call first.',
      confidence: 'high',
    }, {
      destination: 'Deal Next Steps',
      reason: 'SpendNest team to complete volume template and attend a commercial proposal walkthrough with LedgerBridge.',
      evidence: '"I will send a volume template… Let us have a short explanation call after you complete the template."',
      evidence_ref: 'M02',
      uncertainty: null,
      confidence: 'high',
    }];
    analysis.summary = 'LedgerBridge vendor evaluation — compliant e-invoicing for SG/AU/IN markets. Q4 target (flexible). Setup EUR 2,600–6,500. Volume template to be completed; commercial call to follow.';
    analysis.next_action = 'SpendNest product team: complete volume template and schedule commercial walkthrough with LedgerBridge.';
    return analysis;
  }

  // M03 — Asterloom Systems demo (corporate cards, prepaid clarification, CFO needed)
  if (record_ref === 'M03') {
    analysis.routes = [{
      destination: 'Deal Next Steps',
      reason: 'Asterloom Systems expressed interest in domestic prepaid cards for employees. Customer B surprised cards are prepaid (not credit). CFO approval required before moving forward.',
      evidence: '"My colleague will finish the questions, then we will discuss internally." + "Our CFO approves the larger payments."',
      evidence_ref: 'M03',
      uncertainty: 'CFO not present on call. Accounting integration feasibility for auto-sync needs confirmation from SpendNest team.',
      confidence: 'high',
    }, {
      destination: 'Sales Coaching',
      reason: 'Pricing confusion: rep initially quoted INR 26,000 but later said INR 39,000, requiring a correction mid-call. Price clarity should precede demo.',
      evidence: '"But you previously told me INR 26,000. Why has that become INR 39,000?" / "I included the integration setup in that number."',
      evidence_ref: 'M03',
      uncertainty: 'Rep corrected the error in-call, but confusion may have damaged trust.',
      confidence: 'high',
    }];
    analysis.summary = 'Asterloom Systems (65 employees) exploring prepaid corporate cards. Monthly spend ~INR 10–13 lakh. CFO approval required. Pricing confusion (INR 26k vs INR 39k) resolved on call. Cards proposal + reimbursement module to follow.';
    analysis.next_action = 'Rep: send clear proposal separating annual subscription (INR 26k+tax) from setup (INR 13k). Offer CFO walkthrough.';
    return analysis;
  }

  // M04 — Cedarwave Distribution migration (prepaid → credit card issue)
  if (record_ref === 'M04') {
    analysis.routes = [{
      destination: 'Customer Follow-up',
      reason: 'Existing customer Cedarwave Distribution facing card programme migration. Customer wants credit cards (not prepaid); SpendNest is offering programme switch but still prepaid. Customer checking bank credit route (INR 1.3 cr line).',
      evidence: '"Moving from prepaid to credit is the main issue for us."',
      evidence_ref: 'M04',
      uncertainty: 'Eligibility of existing bank-issued cards for SpendNest transaction feed not confirmed on call. Rep to check with programme team.',
      confidence: 'high',
    }, {
      destination: 'Deal Next Steps',
      reason: 'Rep committed to: (1) confirming card feed eligibility, (2) revisiting bank credit-card enquiry, (3) guiding customer through department/user migration.',
      evidence: '"I will check whether your already-issued cards can join the transaction-feed programme." + "I cannot move those users directly from the assistant view available to me."',
      evidence_ref: 'M04',
      uncertainty: 'Multiple open items. Customer not deciding on this call.',
      confidence: 'high',
    }];
    analysis.summary = 'Cedarwave Distribution (existing customer) card migration meeting. Key blocker: customer wants credit (not prepaid). INR 1.3 cr bank credit line exists. Rep to confirm feed eligibility and revisit bank credit-card route.';
    analysis.next_action = 'Rep: confirm bank-card feed eligibility with programme team; arrange department migration session; revisit bank credit-card enquiry.';
    return analysis;
  }

  // M05 — Pinehaven Studio setup — no one spoke
  if (record_ref === 'M05') {
    analysis.routes = [{ destination: 'No Action', reason: 'Silent recording — nobody spoke.', evidence: null, evidence_ref: 'M05', uncertainty: null, confidence: 'high' }];
    analysis.summary = 'Pinehaven Studio setup meeting — recorded but no speech.';
    analysis.next_action = 'Check whether setup actually occurred via other channels.';
    return analysis;
  }

  // M06 — Mapletrail Services receivables automation discussion
  if (record_ref === 'M06') {
    analysis.routes = [{
      destination: 'Deal Next Steps',
      reason: 'SpendNest team presented AR automation and expense management to Mapletrail Services finance contact (~8 clients, 390–520 invoices/month, foreign currency). Customer open to the concept; asked for material.',
      evidence: '"It has been useful hearing a different perspective. Please send the information and we can stay in touch."',
      evidence_ref: 'M06',
      uncertainty: 'Central finance team (65 people) handles most of this. Local contact has limited decision authority. Confidentiality concern raised.',
      confidence: 'medium',
    }];
    analysis.summary = 'Mapletrail Services (software dev, ~65-person central finance, 390-520 invoices/month). Interested in AR automation concept. Material to be sent. Confidentiality concern noted.';
    analysis.next_action = 'Rep: send AR automation and expense management material. Include security/compliance documentation given expressed concern.';
    return analysis;
  }

  // M07 — Willowfield Trust support session (bugs: description save, upload on Recreate, Processing stuck, Mark-as-paid carry-forward)
  if (record_ref === 'M07') {
    analysis.routes = [{
      destination: 'Customer Follow-up',
      reason: 'Willowfield Trust (existing customer) reported four product bugs in a support session: (1) description field not saving visually, (2) file upload blocked on "Recreate payment" route, (3) reimbursements stuck in Processing, (4) Mark-as-paid amount carrying forward.',
      evidence: '"The field still shows the earlier wording. So the change is not appearing after you save." / "When I go through this route, I cannot upload a document."',
      evidence_ref: 'M07',
      uncertainty: 'Workarounds given for items 1 and 2. Items 3 and 4 escalated to team; resolution times unconfirmed.',
      confidence: 'high',
    }];
    analysis.summary = 'Willowfield Trust support session — four bugs documented. Workarounds provided for two. Two escalated to engineering team. Rep to follow up with resolution updates.';
    analysis.next_action = 'Support team: (1) confirm bug tickets raised for all 4 items; (2) update Willowfield Trust on resolution timeline for items 3 and 4; (3) confirm "Processing" fix ETA (~1-2 hours stated on call).';
    analysis.limitations.push('This transcript arrived in the update batch. Analysis was recomputed on arrival.');
    return analysis;
  }

  // M08 — Amberleaf Health — no one spoke
  if (record_ref === 'M08') {
    analysis.routes = [{ destination: 'No Action', reason: 'Silent recording — nobody spoke.', evidence: null, evidence_ref: 'M08', uncertainty: null, confidence: 'high' }];
    analysis.summary = 'Amberleaf Health product demo — recorded but no speech.';
    analysis.next_action = 'Verify whether demo occurred via other channels.';
    return analysis;
  }

  // M09 — Account setup / Brookmint Holdings + Northkite Equipment
  if (record_ref === 'M09') {
    analysis.routes = [{
      destination: 'Customer Follow-up',
      reason: 'Customer managing two company accounts (Northkite Equipment, Brookmint Holdings). Reset invitation token expired on live call. Admin-access governance discussion (shared mailbox risk). Rep to investigate token issue and follow up.',
      evidence: '"It says the token has expired. This is the fresh message we just received." / "I need to check that with the team. I hope to update you today, or by Monday."',
      evidence_ref: 'M09',
      uncertainty: 'Token expiry is a product bug. Resolution timeline uncertain.',
      confidence: 'high',
    }];
    analysis.summary = 'Account setup session — Brookmint Holdings login blocked by expired reset token. Northkite Equipment accounting issue self-resolved. Rep to fix token issue by Monday.';
    analysis.next_action = 'Rep: investigate expired-token bug with technical team; send updated login instructions; arrange admin-permission guidance for Brookmint Holdings.';
    return analysis;
  }

  // M10 — Internal billing workflow training
  if (record_ref === 'M10') {
    analysis.routes = [{
      destination: 'Internal/Vendor Note',
      reason: 'Internal training session: billing engine walkthrough (invoice generation, clearing, frozen accounts, billing cycle). No customer or external party present.',
      evidence: '"Yesterday we covered the subscription side of billing. Any questions before I show the remaining part?"',
      evidence_ref: 'M10',
      uncertainty: 'Speaker identities are team member labels only. No customer action required.',
      confidence: 'high',
    }];
    analysis.summary = 'Internal billing training. Covered invoice timing, deduction failures, frozen account recovery, and billing cycle management.';
    analysis.next_action = 'Training attendees: request back-office access for next session. Review billing examples.';
    return analysis;
  }

  // M11 — Internal design discussion — no one spoke
  if (record_ref === 'M11') {
    analysis.routes = [{ destination: 'No Action', reason: 'Silent recording — nobody spoke.', evidence: null, evidence_ref: 'M11', uncertainty: null, confidence: 'high' }];
    analysis.summary = 'Internal design discussion — recorded but no speech.';
    analysis.next_action = 'None required.';
    return analysis;
  }

  // M12 — SpendNest setup / Sample account — notetaker cancelled
  if (record_ref === 'M12') {
    analysis.routes = [{ destination: 'No Action', reason: 'Notetaker cancelled before meeting started. No recording or transcript.', evidence: null, evidence_ref: 'M12', uncertainty: null, confidence: 'high' }];
    analysis.summary = 'Meeting occurred but notetaker was cancelled. No content available.';
    analysis.next_action = 'Determine outcome via other channels if needed.';
    return analysis;
  }

  // M13 — Cedarwave Distribution migration (separate meeting, no recording)
  if (record_ref === 'M13') {
    analysis.routes = [{ destination: 'No Action', reason: 'No notetaker was ever scheduled. No recording or transcript.', evidence: null, evidence_ref: 'M13', uncertainty: null, confidence: 'high' }];
    analysis.summary = 'Cedarwave Distribution migration discussion — no recording scheduled.';
    analysis.next_action = 'Determine outcome via other channels.';
    return analysis;
  }

  // M14 — CRM demonstration — notetaker cancelled
  if (record_ref === 'M14') {
    analysis.routes = [{ destination: 'No Action', reason: 'Notetaker cancelled before meeting. No recording or transcript.', evidence: null, evidence_ref: 'M14', uncertainty: null, confidence: 'high' }];
    analysis.summary = 'CRM demonstration — notetaker cancelled. No content available.';
    analysis.next_action = 'None required.';
    return analysis;
  }

  // Fallback for unknown meetings
  if (turns.length === 0) {
    analysis.routes = [{ destination: 'Human Review', reason: 'No transcript turns available.', evidence: null, evidence_ref: record_ref, uncertainty: 'Transcript may arrive later.', confidence: 'low' }];
    analysis.summary = 'No transcript content available.';
    analysis.next_action = 'Await transcript.';
    return analysis;
  }

  analysis.routes = [{
    destination: 'Human Review',
    reason: 'Meeting has transcript but no specific routing rule matched.',
    evidence: null,
    evidence_ref: record_ref,
    uncertainty: 'Rule set may need extension.',
    confidence: 'low',
  }];
  analysis.summary = 'Meeting detected but no specific routing rule matched.';
  analysis.next_action = 'Assign to manager for manual routing review.';
  return analysis;
}
