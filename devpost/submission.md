# Devpost submission: Try-On Listing

## Project name

Try-On Listing

## Tagline

Turn one garment photo into YouCam virtual try-on previews, a product page that marks what it does not know, and a shopper's own-photo preview.

## Links

- Code (MIT): https://github.com/kks0488/tryon-listing
- Live app: https://tryon-listing.vercel.app (live mode is protected by a studio access code; demo mode runs locally with no keys: `npm test`, then `npm start`)
- Demo video: YouTube link to be added after upload

## Inspiration

Independent apparel sellers usually photograph a garment once, flat on a table or on a hanger. Booking a model and a studio for every item is not realistic for a one or two person shop. Shoppers then look at a flat shirt, try to imagine it on a person, and send the same questions about size and fabric on every listing. We wanted a small studio that gives a seller a worn preview of the garment, a product page built from the facts they actually have, and a way for a shopper to see the garment on their own photo, without pretending that a picture can tell anyone their size.

## What it does

Try-On Listing is a web studio with three tabs.

- **Your studio.** The seller uploads one front-facing top and a model photo they have permission to use, ticks an explicit permission box, and creates a try-on collection. Each preview is one YouCam Clothes VTO task. The studio counts generations and units for the session. In demo mode it offers three original illustrated models (Alex, Jordan, Sam) and charges 2 simulated units per image.
- **Shopper preview.** The first try-on image becomes the product photo. One click writes the product page from the seller's confirmed facts: headline, description, bullets and a set of questions and answers. Size guidance asks the seller for chest width, shoulder width, sleeve length and garment length instead of guessing a fit from the image, and a fixed notice says that try-on shows appearance, not body measurements. A shopper can upload their own photo, give consent, and run the same try-on on themselves.
- **Content kit.** The same facts produce ad headlines and body copy, keywords, a 32-second shorts script with timed scenes, and a "before you publish" checklist. Anything the seller has not confirmed, such as fabric, care or price, is marked `[needs info]`. The kit downloads as one JSON file that carries a review notice and the copy mode (live or demo).

Changing the garment, the model photo or the product facts clears old previews and copy so stale content cannot be published by mistake. "Clear session" removes photos, previews, generated content and the access code from memory. Photos are never written to disk or a database.

**Consumer and eCommerce value.** For the seller: a worn product image and a full product page from one flat photo, at a known unit cost per preview, with review prompts where facts are missing. For the shopper: a preview of the garment on a model or on themselves, plus honest size questions, before they buy.

## How we built it

The app is plain HTML, CSS and JavaScript in the browser and one Node.js API function (`api/index.js`) that runs the same way locally (`server.js`) and on Vercel. There are no runtime npm dependencies.

**YouCam Clothes VTO (cloth-v4), server side** (`src/youcam.js`), base URL `https://yce-api-01.makeupar.com/s2s/v2.0`, bearer authentication with the API key, which never leaves the server:

1. `POST /s2s/v2.0/file` with `{files:[{content_type, file_name, file_size}]}` for the model photo and for the garment photo. Before this, the server checks that each image is a real JPEG or PNG (magic bytes) under 1.4 MB.
2. `PUT` the raw image bytes to each signed URL returned in `data.files[].requests[]`, with the headers YouCam supplies. The server only accepts HTTPS upload hosts on `amazonaws.com` or `makeupar.com`.
3. `POST /s2s/v2.0/task/cloth-v4` with `{src_file_id, ref_file_id, garment_category: "upper_body", change_shoes: false, filter_multi_person: "strict"}`. The returned `task_id` is wrapped in an HMAC-signed token that expires after 24 hours and is sent to the browser.
4. The browser polls our API about every 10 seconds (up to 36 times, about 6 minutes). Our server calls `GET /s2s/v2.0/task/cloth-v4/{task_id}` until `task_status` is `success` or `error`.
5. On success the server downloads `data.results.url` itself (JPEG or PNG, size capped), returns the image to the browser as a data URL, then calls `POST /s2s/v2.0/task/delete` with the `task_id`. The browser is told whether deletion worked; if not, a "Retry provider deletion" control keeps the token in memory. The result URL is never exposed to the browser.

**YouCam unit pricing:** `GET /s2s/v2.0/credit/feature-cost?page_size=20`, following `starting_token` pages, finds the cloth-v4 SKU and computes units per result as `amount / proc_unit`. This runs separately from task creation so a slow pricing call cannot delay a paid task. Unknown pricing stays shown as unknown.

**How results flow into the product page:** each finished image is added to the collection grid with a label (`YOUCAM TRY-ON` in live mode, `SIMULATED · ILLUSTRATION` in demo mode). The first image becomes the hero photo of the shopper product page. The shopper's own-photo try-on replaces that hero image for the shopper's session only.

**Product copy:** `src/listing.js` sends the product name and confirmed facts, plus a list of forbidden claims (no fit, measurement, fabric, care or policy claims inferred from try-on images), to an OpenAI-compatible endpoint. The default is Nebius Token Factory with `nvidia/Nemotron-3_5-Lightning`, JSON mode, thinking disabled, 4,500 output tokens and a 45-second timeout. The prompt and parser come from our MIT commerce content core (`src/commerce.js`). Empty, reasoning-only, truncated or invalid answers fall back to fixed demo copy with a visible notice, so the export never claims live copy it did not get.

**Protection for a public deployment:** when provider keys are set, every live endpoint requires a studio access code sent in a header and compared in constant time; without it the API returns 401 and nothing reaches YouCam. Error messages never include provider bodies, signed URLs or keys.

**Testing:** 17 Node tests (`node --test`) run against mocked responses shaped like the official schemas: file validation, signed upload, task creation and polling, download before deletion, expired or tampered tokens, access protection, pricing pagination, and demo and live copy. GitHub Actions runs them on every push. A Playwright script drives the real app in headless Chromium for browser checks and screenshots.

On October 16, 2026 we ran one real cloth-v4 task and one real copy call against the production deployment. The inputs were our own illustrated model and garment, rasterized to PNG, not a real person. YouCam returned a new image, the server downloaded it and the task deletion was confirmed, and the account balance went down by 2 units. The copy call used 597 prompt and 1,100 completion tokens. Those captures are in `media/`; the live copy from that check appears in the video, labeled with the date.

On October 30, 2026 we ran one more real cloth-v4 task (`garment_category: upper_body`) with photographic-looking inputs: a plain gray crewneck sweatshirt laid flat and a full-length model photo. Both input images were generated for this demo. There is no real person and no logo in them. The task was deleted after download. YouCam replaced the model's white T-shirt with the sweatshirt and kept her face, pose, jeans and shoes. The inputs and the unedited result are in `devpost/live/`, and the video shows them side by side, labeled with the date.

## Challenges we ran into

- **Units on a public URL.** Each live preview costs provider units, and a hackathon demo is public. We added the studio access code for live calls and a full demo mode that runs the same code with no keys, illustrated results and simulated units, so anyone can try the flow without spending units.
- **Cleaning up provider data.** YouCam's task API can delete a finished task together with its inputs and outputs, but a running task cannot be deleted. We download the result first, then delete, report the real outcome to the browser, and keep a retry control for tasks that could not be deleted. We also document the cases we cannot clean up, such as a tab closed while a task is still running.
- **Serverless limits.** Vercel functions have a request size limit and a time limit, so images are capped at 1.4 MB and the browser polls in short requests instead of one long request waiting for the task.
- **Copy that stays honest.** A reasoning model can return think blocks, an empty answer or JSON cut off at the token limit. We request JSON mode with thinking disabled, strip think blocks, reject truncated answers, and fall back to fixed copy with a notice when the answer is not usable.

## Accomplishments that we're proud of

- A complete cloth-v4 lifecycle, including deletion, verified in production on October 16 with our own placeholder art, then a second real cloth-v4 task on October 30 with photographic-looking generated inputs.
- The seller, shopper and content flows work end to end in demo mode with no keys, and the same code switches to live mode when keys are set.
- Fit is never inferred. The product page, FAQ, export and prompts all say that try-on is a visual preview, and missing facts stay visible as `[needs info]`.
- No runtime dependencies, no database, no analytics, and 17 passing tests in CI.

## What we learned

- The cloth-v4 flow is simple to call but has a real lifecycle: allocate files, upload, run, poll, download, delete. Most of our work went into the parts after "it returned an image".
- Placeholder art is enough to verify an integration, but not image quality. A flat-lay garment and a full-length photo with one standing person gave a much more useful result. We have still not tested real seller photos, which come with wrinkles, hangers and mixed lighting.
- A prompt that forbids fit claims is not a guarantee. In the same live check, the generated description still said the shirt "offers a relaxed fit that works for various body types", a claim the seller had not made. That is why the seller review notice stays on every screen and in the export.

## What's next for Try-On Listing

- Test photographic quality with real seller garment photos and model photos used with permission, and tune the input guidance for sellers.
- Support garment categories beyond upper-body tops.
- Durable seller workspaces and an embeddable shopper try-on widget for existing store pages.
- Run a small pilot with independent sellers to measure whether previews and size questions reduce repeated fit questions. We have not measured this yet.

## Built with

- YouCam Clothes VTO API (cloth-v4)
- YouCam S2S file upload and task delete endpoints
- YouCam unit system API (feature-cost)
- JavaScript (ES modules), HTML, CSS
- Node.js 22
- Vercel (static hosting and Node function)
- Nebius Token Factory (OpenAI-compatible API) with NVIDIA Nemotron
- GitHub Actions
- Node test runner
- Playwright and Chromium (browser checks and demo capture)

## Updated during the submission period

The whole project was built inside the submission period (September 29 to November 2, 2026). The public repository was created on October 16, 2026. Its git history starts with `e188935` on October 16, 2026 (seller studio and YouCam VTO integration), followed by `5db790e` (formatting of the reused core) and `609c389` (live YouCam and copy flows verified in production) on the same day, and `598a1eb` on October 17, 2026 (path cleanup). This `devpost/` folder, including the October 30 live cloth-v4 run (`5560277`), was added on October 30, 2026. The only reused code is our own MIT commerce content core, copied into `src/commerce.js`; its repository was also created on October 16, 2026. No code or media from before September 29, 2026 is included.

## Files in this folder

- `demo.mp4`: the demo video for YouTube (1920 x 1080, H.264, silent audio track, burned-in English captions)
- `thumbnail.png`: 1280 x 720 video and project thumbnail
- `gallery-1-production-studio.png` to `gallery-5-live-content-kit.png`: project gallery images (gallery 2 is the Oct 30 live result: garment, model and try-on side by side)
- `live/`: the Oct 30 cloth-v4 inputs (generated images) and the unedited result
