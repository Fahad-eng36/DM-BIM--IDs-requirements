# DM-BIM-requirements

Two unofficial pages built from the `IDS.json` rule file that ships with the Dubai Municipality BIM tools. The official QA/QC checker is the authority.

## Requirements browser — `index.html`

Open `index.html` in a browser and fill in the question at the top: "What does a [element] need at [Preliminary / Final / Inspection] stage?" The page lists the required and optional properties for that element, grouped by property set, with each property's data type and an example value. You can also search one property, such as `FireRating`, across every element.

## IFC checker — `checker.html`

Open `checker.html` and drop an `.ifc` export on it. It reports which required properties each element is missing at the chosen stage, by element group, by property and by element, with Revit IDs to select them and a table to paste into Excel. The file is read in the browser and is not uploaded.

It checks that required properties exist and hold a value. It does not check geometry, usage codes or the values themselves.

### From the command line

Needs Node.js and a copy of `IDS.json` from the DM tools (`InfoDeliverySpecs/Resources/IDS.json`).

```bash
node ifc-checker/cli.js model.ifc Final --ids path/to/IDS.json --csv issues.csv
```

### Rebuilding after a new DM release

```bash
node ifc-checker/build.js path/to/IDS.json
```

This writes `ifc-checker/dist/checker.html`; copy it over `checker.html`. `gen-sample.js` regenerates the example model the page opens with.
