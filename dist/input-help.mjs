const helpText = {
  'video-file': 'Choose a tank video from your device, or drag it here. The video is processed in your browser.',
  interval: 'Time between sampled frames, in milliseconds. Smaller values analyze more frames and take longer. Use 250 ms or less for tracking nearby frames.',
  'filter-exact-count': 'Keep only sampled frames with exactly the selected number of detected fish. Other samples still help tracking, but are left out of results and exports.',
  'filter-frame-count': 'Required number of detected fish for a frame to appear in results. Set this to 5 to keep only five-fish frames.',
  threshold: 'Maximum center-to-center distance, in the selected distance units, for linking two fish. Linked fish form groups, including chains of links.',
  'grid-pixels': 'Measure the width of one 0.5-inch grid square in the original video, in pixels. This converts pixel distances to approximate inches for background subtraction.',
  'expected-fish': 'Number of real fish in the tank. Background mode with one fish keeps the strongest foreground-contrast candidate; close choices remain uncertain. Larger counts guide overlap recovery and the optional crop-center rule.',
  'intervening-frames': 'Experimental: use decoded frames between saved samples to update continuity and overlap evidence. Off by default. Processing is slower; review and export keep the sample interval.',
  'threshold-overlap': 'Experimental multi-fish detection: retain larger blobs and try stronger contrast thresholds to separate overlapping fish. Split centers remain uncertain. Off by default; changing this option requires reanalysis.',
  'track-fish': 'Follow provisional fish paths across nearby samples. Identities may swap during overlap; dashed centers marked † are uncertain estimates.',
  'prefer-center': 'When candidates exceed the known fish count, keep those closest to the crop center. With one fish expected, foreground contrast takes precedence. Real fish near the edge may be excluded, so review the pink × marks.',
  'crop-tool': 'Choose whether selecting on the preview selects the tank crop, marks a light/dark region, adds a reflection area, or draws a line for distance calibration. Reflection areas lower candidate priority only when there are more detections than expected; fish there remain detectable.',
  'selection-shape': 'Drag a rectangle, or click four corners in order around the edge for an angled tank, light/dark region, or reflection area. Undo corner and Cancel corners adjust an unfinished selection.',
  'suppress-flicker': 'Learn the usual brightness range at each pixel from background samples. In dark regions, require a change outside that range. This reduces flickering fixtures without excluding fish that cross them. Turn off if faint fish are missed.',
  'calibration-length': 'Real length, in the selected distance units, of the line you drew. For example, a line across four half-inch grid squares is 5.08 centimeters. Click Use this scale to calculate the calibration and update existing distance results.',
  'crop-x': 'Left edge of the crop, in original video pixels measured from the left of the frame. Click Apply crop to use it.',
  'crop-y': 'Top edge of the crop, in original video pixels measured from the top of the frame. Click Apply crop to use it.',
  'crop-width': 'Width of the tank crop in original video pixels, at least 30. Keep the crop inside the frame, then click Apply crop.',
  'crop-height': 'Height of the tank crop in original video pixels, at least 30. Include the swimming area, then click Apply crop.',
  'cluster-distance': 'Adjust the link distance in the selected units to recalculate groups and spacing metrics from the existing centers. The chart shows the selected frame.',
  'human-frame-filter': 'Filter the current results by All, Missing (no centers), Ambiguous (unresolved candidate selection), Uncertain (uncertain or estimated positions), or Flagged (any of those issues). Applied corrections update these categories. Included results and original count mismatches remain available. Navigation and playback follow this view; filtering does not change summary or export inclusion.',
  'human-expected-fish': 'Number of real fish in this recording, used to find count mismatches in review. Starts with the known count from setup. Changing this review count does not rerun detection.',
  'human-frame-number': 'Jump to a frame by its position in the current review view, starting at 1. The original sampled-frame number is shown beside the time.',
  'human-slider': 'Move through the current review view to check detections and place your own fish-center marks.',
  'human-show-full': 'Show the entire video frame so you can spot fish outside the crop. Marks outside the usable area are exported but excluded from the comparison.',
  'human-show-auto': 'Overlay the original automatic centers for comparison with edited or applied centers.',
  'human-show-sharpness': 'Show frame-local candidate IDs and sharpness scores. Compare scores within the same recording; they are not probabilities.',
  'human-show-nearest': 'Display each detected fish’s distance to its nearest detected neighbor, in approximate selected units using your grid calibration.',
};

let activeHelp;
let nextId = 0;

function closeHelp() {
  if (!activeHelp) return;
  activeHelp.tooltip.hidden = true;
  activeHelp.trigger.setAttribute('aria-expanded', 'false');
  activeHelp = null;
}

/** Add help beside a field caption, or beside a dynamically rendered control. */
export function addInputHelp(input, text) {
  const label = input.labels?.[0];
  const caption = document.createElement('span');
  caption.className = 'input-caption';
  if (input.id === 'video-file') {
    caption.append('Tank video');
    label.before(caption);
  } else if (label) {
    // Keep checkbox placement and existing label/input associations intact.
    const nodes = [...label.childNodes].filter(node => node !== input);
    nodes.forEach(node => caption.append(node));
    if (input.type === 'checkbox') input.after(caption);
    else label.prepend(caption);
  } else if (input.type === 'range') {
    caption.append(input.getAttribute('aria-label'));
    input.before(caption);
  } else {
    input.after(caption);
  }

  const trigger = document.createElement('span');
  trigger.className = 'input-help';
  trigger.tabIndex = 0;
  trigger.setAttribute('role', 'button');
  trigger.setAttribute('aria-label', `Help for ${input.getAttribute('aria-label') || caption.textContent.trim()}`);
  trigger.setAttribute('aria-expanded', 'false');
  trigger.textContent = '?';
  const tooltip = document.createElement('span');
  tooltip.className = 'input-tooltip';
  tooltip.id = `input-help-${++nextId}`;
  tooltip.setAttribute('role', 'tooltip');
  tooltip.textContent = text;
  tooltip.hidden = true;
  tooltip.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
  });
  trigger.setAttribute('aria-describedby', tooltip.id);
  input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), tooltip.id].filter(Boolean).join(' '));
  caption.append(trigger, tooltip);

  function openHelp() {
    closeHelp();
    tooltip.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    activeHelp = { trigger, tooltip };
    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - tooltip.offsetWidth - margin));
    const below = rect.bottom + 8;
    const top = below + tooltip.offsetHeight <= window.innerHeight - margin ? below : Math.max(margin, rect.top - tooltip.offsetHeight - 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }
  trigger.addEventListener('mouseenter', openHelp);
  trigger.addEventListener('focus', openHelp);
  caption.addEventListener('mouseleave', () => {
    if (document.activeElement !== trigger && activeHelp?.trigger === trigger) closeHelp();
  });
  trigger.addEventListener('blur', () => { if (activeHelp?.trigger === trigger) closeHelp(); });
  trigger.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    openHelp();
  });
  trigger.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      openHelp();
    }
  });
}

export function initializeInputHelp() {
  for (const [id, text] of Object.entries(helpText)) addInputHelp(document.getElementById(id), text);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeHelp(); });
  document.addEventListener('click', event => { if (!event.target.closest('.input-help, .input-tooltip')) closeHelp(); });
  window.addEventListener('resize', closeHelp);
  window.addEventListener('scroll', closeHelp, true);
  window.addEventListener('hashchange', closeHelp);
}
