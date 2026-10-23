const helpText = {
  'video-file': 'Choose a tank video from your device, or drag it here. The video is processed in your browser.',
  interval: 'Time between sampled frames, in milliseconds. Smaller values analyze more frames and take longer. Use 250 ms or less for tracking nearby frames.',
  threshold: 'Maximum center-to-center distance, in inches, for linking two fish. Linked fish form groups, including chains of links.',
  'grid-pixels': 'Measure the width of one 0.5-inch grid square in the original video, in pixels. This converts pixel distances to approximate inches for either detection method.',
  method: 'Background subtraction finds dark fish against a fixed tank background. Roboflow uses the configured trained model and publishable key.',
  'expected-fish': 'Number of real fish in the tank. This guides checks for missed or overlapping fish and the optional crop-center rule; it does not guarantee this many detections.',
  'track-fish': 'Follow provisional fish paths across nearby samples. Identities may swap during overlap; dashed centers marked † are uncertain estimates.',
  'prefer-center': 'When candidates exceed the known fish count, keep those closest to the crop center. Real fish near the edge may be excluded, so review the pink × marks.',
  'model-slug': 'Roboflow project identifier, such as zebrafish_in_aquarium. Enter only the slug, without the workspace name or a URL.',
  'model-version': 'Number of the trained model version from the Roboflow Models or Deploy tab.',
  confidence: 'Minimum model confidence from 0 to 1. Lower values admit more detections, including possible false positives; higher values may miss fish.',
  'publishable-key': 'Roboflow workspace publishable key used to load the model in your browser. Use a publishable key, never a private API key.',
  'frame-slider': 'Move through the sampled analysis frames. The preview and group chart show the selected frame.',
  'show-sharpness': 'Overlay each candidate’s frame-local ID and sharpness score (S). Higher scores usually mean sharper edges, not a higher probability of being a fish.',
  'crop-tool': 'Choose whether dragging on the preview selects the tank crop, adds a reflection mask, or draws a line for distance calibration. Masks exclude those areas from every analyzed frame.',
  'calibration-length': 'Real length in inches of the line you drew. For example, a line across four half-inch grid squares is 2 inches. Click Use this scale to calculate the calibration and update existing distance results.',
  'crop-x': 'Left edge of the crop, in original video pixels measured from the left of the frame. Click Apply crop to use it.',
  'crop-y': 'Top edge of the crop, in original video pixels measured from the top of the frame. Click Apply crop to use it.',
  'crop-width': 'Width of the tank crop in original video pixels, at least 30. Keep the crop inside the frame, then click Apply crop.',
  'crop-height': 'Height of the tank crop in original video pixels, at least 30. Include the swimming area, then click Apply crop.',
  'cluster-distance': 'Adjust the link distance in inches to recalculate groups and spacing metrics from the existing centers. The chart shows the selected frame.',
  'human-frame-number': 'Jump to a sampled frame by its number, starting at 1. These are analysis samples, not the video’s original frame numbers.',
  'human-slider': 'Move through sampled frames to review detections and place your own fish-center marks.',
  'human-show-full': 'Show the entire video frame so you can spot fish outside the crop. Marks outside the usable area are exported but excluded from the comparison.',
  'human-show-auto': 'Overlay automatically detected fish centers to compare them with your own marks.',
  'human-show-sharpness': 'Show frame-local candidate IDs and sharpness scores. Compare scores within the same recording; they are not probabilities.',
  'human-show-nearest': 'Display each detected fish’s distance to its nearest detected neighbor, in approximate inches using your grid calibration.',
  'human-reviewed': 'Record that you checked this frame, even if no fish are visible. This status belongs to this frame and does not add or change center marks.',
  'label-frame-number': 'Jump to a sampled training frame by number, starting at 1. Only frames marked labeled are included in the dataset.',
  'label-slider': 'Browse the sampled training frames. Navigating past a frame does not mark it labeled.',
  'label-tool': 'Click to add one box per real fish, or choose Move or resize to adjust existing boxes. Label overlapping fish separately and leave reflections unlabeled.',
  'label-box-width': 'Width in pixels of the selected fish box, or the default width for new boxes when none is selected.',
  'label-box-height': 'Height in pixels of the selected fish box, or the default height for new boxes when none is selected.',
  'label-complete': 'Confirm that every real fish in this frame is boxed. Only confirmed frames enter the dataset; confirm an empty frame only when no real fish are visible.',
  'label-step': 'Number of sampled frames to move with Previous, Next, or the arrow keys. A larger step lets you label frames farther apart.',
  'label-progress-import': 'Restore a saved progress JSON for this video, crop, and interval. Restoring replaces this labeling project’s current marks, including drafts.'
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
