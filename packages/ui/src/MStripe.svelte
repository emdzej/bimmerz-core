<script lang="ts">
  /**
   * BMW M tricolour stripe — three thin bars in the canonical
   * light-blue / dark-blue / red order, identical to the signature
   * carried on M cars' kidney grilles and side skirts and the visual
   * top-bar bimmerz.app + hub.bimmerz.app both use.
   *
   * Renders a `<div role="presentation">` with the `.m-stripe` /
   * `.m-stripe__band--{light|dark|red}` classes from
   * `@emdzej/bimmerz-theme/tokens.css`. Consumer must have those
   * tokens imported for the colours to resolve.
   *
   * Default height is 4px (the tokens.css default); override via the
   * `class` prop if you want a thicker bar for a hero or a thinner
   * one for a sidebar:
   *
   *   <MStripe class="h-1" />   ; 4px (default)
   *   <MStripe class="h-2" />   ; 8px
   */
  interface Props {
    /** Extra Tailwind classes appended to the default `.m-stripe`. */
    class?: string;
  }

  const { class: extraClass = "" }: Props = $props();
</script>

<div class="m-stripe {extraClass}" aria-hidden="true">
  <div class="m-stripe__band m-stripe__band--light"></div>
  <div class="m-stripe__band m-stripe__band--dark"></div>
  <div class="m-stripe__band m-stripe__band--red"></div>
</div>
