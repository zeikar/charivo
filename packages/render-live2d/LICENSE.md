# License

`@charivo/render-live2d` is a composite work. Different parts carry different
licenses, and the published bundle contains all of them.

## Charivo-authored code — MIT

Everything under `src/` that is not derived from the Cubism SDK samples is
Copyright (c) Zeikar, licensed under the MIT License. See the
[repository LICENSE](https://github.com/zeikar/charivo/blob/main/LICENSE).

## Live2D Cubism Core — Live2D Proprietary Software License

`live2dcubismcore.min.js` is Copyright (C) 2019 Live2D Inc. It is listed in
`Core/RedistributableFiles.txt` as **Redistributable Code**, and is bundled here
under the terms of the
[Live2D Proprietary Software License Agreement](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html).

Redistribution is permitted for a derivative work that adds major functions
using the Redistributable Code (§5.1, §5.2.1). Downstream distributors and end
users are bound by protections equivalent to that agreement (§5.2.2) — by
depending on this package you accept those terms.

## Live2D Cubism Framework and Samples — Live2D Open Software License

`Framework/src/**` and the sample-derived code in `src/cubism/**` are
Copyright (c) Live2D Inc., used under the
[Live2D Open Software License Agreement](https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html).

The agreement forbids removing or modifying license indications, copyright
notices, and proprietary notices (§5.1, §5.7). The bundled output therefore
carries a preserved notice banner; **do not strip it when re-bundling this
package.**

## Publication License — your responsibility

Publishing or distributing a derivative work requires a **Live2D Publication
License Agreement** (Proprietary §2.1). Live2D also calls this the *Cubism SDK
Release License* — the
[release-license page](https://www.live2d.com/en/download/cubism-sdk/release-license/)
is titled "SDK Release License (Publication License Agreement)". It is one
instrument under two names, not two separate obligations.

General Users, Small-Scale Enterprises, and Qualified Educational Institutions
— broadly, individuals and organizations whose sales for the most recent fiscal
year are under 10,000,000 JPY — may be exempt from executing it and from the
license fee (§2.2).

**That exemption does not cover an Expandable Application.** §2.2: "this
exemption is not applicable for Publishing the Expandable Application". §2.1
adds that publishing one requires making "an application in advance" and
obtaining "approval by Live2D", on top of the agreement itself. §1.5 defines an
Expandable Application as a derivative work "having significant expandability",
including one that "uses and generates any indefinite number of models by
adding or combining files or data (e.g. avatars, live streaming applications,
video generators/video makers)".

Read that definition before assuming the exemption applies to you. A renderer
that loads arbitrary models — which is exactly what this package is — plausibly
falls inside it **regardless of your revenue**. Charivo has not sought or
obtained Live2D's approval, and takes no position on your behalf.

Charivo does not and cannot grant this license. Resolve your own position with
Live2D before you ship.

## Model assets — not included

No Live2D model is distributed in this package. The models used by the Charivo
demos are covered by the
[Live2D Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html)
and are credited in the demo applications, not here.

## Vendored license notices

Live2D's own notice files ship with this package. They state the obligations and
link to the agreements rather than reproducing them — the full agreement texts
are hosted by Live2D at the URLs above.

- `CubismSdkForWeb-5-r.4/LICENSE.md` — SDK-wide terms: the Cubism SDK Release
  License obligation, plus links to the Open Software and Proprietary agreements
- `CubismSdkForWeb-5-r.4/Framework/LICENSE.md` — the same terms scoped to the
  Cubism Web Framework
- `CubismSdkForWeb-5-r.4/Core/LICENSE.md` — links to the Proprietary Software
  License Agreement covering Cubism Core
- `CubismSdkForWeb-5-r.4/Core/RedistributableFiles.txt` — the list of files
  Live2D permits redistributing
- `CubismSdkForWeb-5-r.4/NOTICE.md` — Live2D's SDK migration and troubleshooting
  notices; not a license document, shipped to keep the vendored tree intact
