# KoBo Interface Direction

## Foundations

- Register: practical product interface.
- Theme: light-first for ordinary daytime phone and laptop use.
- Color: existing teal primary, cyan accent, neutral surfaces, semantic status colors.
- Type: Plus Jakarta Sans with compact headings and readable body copy.
- Shape: 12 px cards, 8 px controls, 6 px badges.
- Motion: restrained, 150 to 250 ms, ease-out, transform and opacity only.
- Density: medium-high in owner tools, medium in renter flows.

## Interaction Rules

- One primary action per state.
- Never use color as the only status signal.
- Frequent actions should feel immediate; no decorative entrance motion.
- Avoid `transition: all`; animate only the changed property.
- Loading, empty, error, success, and disabled states are required for each async flow.
- Keep the existing content container and responsive navigation.

## Copy Rules

- Indonesian, direct, and specific.
- Say `pengajuan` before owner approval and `sewa` only after approval.
- Say what KoBo records; do not imply escrow, bank verification, or identity verification unless implemented.
- Explain rejection and conflicts without blaming the renter or owner.
