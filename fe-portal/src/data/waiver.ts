import type { Waiver } from "@/types";

/**
 * A generic waiver, for the fixture-backed editor screen only.
 *
 * The live waiver is one row per Tenant (`waiver`, unique on `tenant_id`) and is
 * a studio's own legal position — it is emphatically not this text. Nothing here
 * names a studio, so a screen still on fixtures cannot show one studio's legal
 * wording to another. Wiring `admin/waiver` to the backend is the ticket that
 * removes this file.
 */
export const waiver: Waiver = {
  bodyHtml: `<h2>Liability Waiver and Release</h2>
<p>I, the undersigned, in consideration of being permitted to participate in classes, workshops, private sessions, and events offered by the studio ("the Studio"), acknowledge and agree to the following:</p>
<h3>1. Voluntary Participation</h3>
<p>I understand that yoga is a physical activity that involves stretching, balance, breathing techniques, and meditation. I am voluntarily participating with full knowledge that there is a risk of personal injury, property loss, or death. I expressly agree to assume all such risks.</p>
<h3>2. Health Representation</h3>
<p>I confirm that I am physically and mentally able to participate in yoga practice. I have consulted with a physician about any pre-existing medical condition that may affect my participation. I will inform my instructor of any injury, condition, or pregnancy before each class.</p>
<h3>3. Personal Belongings</h3>
<p>The Studio is not responsible for any loss, theft, or damage to personal belongings.</p>
<h3>4. Photography</h3>
<p>From time to time the Studio may photograph or video classes for promotional use. If I do not wish to be included, I will inform staff before the class begins.</p>
<h3>5. Release of Liability</h3>
<p>I release the Studio, its instructors, employees, and affiliates from any and all liability, claims, demands, or causes of action arising out of or related to any loss, damage, or injury that may be sustained by me while participating in any activity at the Studio.</p>
<p>By ticking the acceptance box during registration, I confirm I have read, understood, and agreed to the terms above.</p>`,
  updatedAt: "2025-04-01T08:00:00.000Z",
};
