# SDF UI

SdfUi is a framework to easily create 3D elements from normal HTML elements. The scene is constructed as a [Signed Distance Field](https://iquilezles.org/articles/distfunctions/) (SDF), which allows for easy blending between objects.

Some of the capabilities are shown [here](https://puutzza.github.io/sdf-ui/).

## Table of Contents
- [SDF UI](#sdf-ui)
  - [Table of Contents](#table-of-contents)
  - [Technology](#technology)
  - [SdfCanvas](#sdfcanvas)
    - [Coordinate System and Camera](#coordinate-system-and-camera)
    - [Usage](#usage)
    - [Public Members and Functions](#public-members-and-functions)
    - [Compile Time Constants](#compile-time-constants)
  - [Layers](#layers)
  - [Render Layers](#render-layers)
  - [CSS Values](#css-values)
  - [Supported Elements](#supported-elements)
    - [1. Sphere](#1-sphere)
    - [2. Simple Box](#2-simple-box)
    - [3. Box](#3-box)
    - [4. Text](#4-text)
    - [5. Cylinder](#5-cylinder)
    - [6. Triangle](#6-triangle)
    - [7. Custom Elements](#7-custom-elements)
  - [Lights](#lights)
  - [Modifiers](#modifiers)
    - [Twist](#twist)
  - [Shading](#shading)

## Technology
SdfUi uses only HTML, CSS, JavaScript, and WebGL to create and render the scene. It is fully self-contained and has no external dependencies. 

## SdfCanvas
`SdfCanvas` is the central class of this framework that controls most of the functionality.

### Coordinate System and Camera
Each `SdfCanvas` is bound to a [canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API). The origin of the created space is at the top left. The x-axis increases to the left, the y-axis to the bottom, and the z-axis towards the user (out of the screen). 

The orthographic camera has the position `(0, 0, cameraZ)` and a view direction of `(0, 0, -1)`. 

### Usage
To use SDF UI, you must include the sdf-elements script in your HTML file:
```html
<script src="src/scripts/sdf-elements.js" type="module"></script>
```
You also have to create a canvas element and give it a unique ID:
```html
<canvas id="canvas"></canvas>
```
Next, create a script to instantiate an SDF canvas from the HTML canvas you just created. First, import `SdfCanvas`, and then create a new `SdfCanvas` object while passing the unique ID as a parameter.
```js
import { SdfCanvas } from "../src/scripts/sdf-ui.js";

// SdfCanvas accepts an options object with the following properties (showing default values):
const options = {
    renderLayers: [0],                // Which layers are rendered by this canvas (see section Render Layers)
    downscaleFactorX: 2,              // Factor to downscale the horizontal resolution
    downscaleFactorY: 2,              // Factor to downscale the vertical resolution
    topFace: false,                   // Controls if the --z value of the elements is the depth of the top face or the center of the object
    cameraZ: 10,                      // Controls the z-coordinate of the camera
    useAA: false,                     // Enables Anti-Aliasing
    twoDMode: false,                  // Enables the 2D mode
    customShadeFunction: "",          // Custom shading function
    onCompilationComplete: undefined  // Callback function for when the compilation is complete
};

// Example Initialization:
const sdfCanvas = new SdfCanvas("canvas", { downscaleFactorX: 10 });
sdfCanvas.cameraZ = 15;
```
After creating the canvas, you must call `initWebgl()` before you can draw the scene with `draw()`. 

### Public Members and Functions
```js
/**
 * This static member controls the global layers. See section Layers for more.
 */
static layers = [
    new SdfLayer(SdfCommands.SMOOTH_UNION, 30),
]

/**
* Performs the passed function for every tracked element.
* Usefull for e.g. adding or removing css classes.
* @param {Function} f - The callback function to execute for each element.
*/
static performForEachElement(f);

/**
 * Boolean to check if the canvas is ready (e.g., compilation complete).
 */
get ready();

/**
 * Initializes WebGL.
 * @param {number} compilePolicy - If compilation should continue even if background compilation is not available. Should be SdfCanvas.COMPILE_POLICY_ONLY_PARALLEL or SdfCanvas.COMPILE_POLICY_ALSO_BLOCKING
 * @returns {Promise<boolean>} Boolean if compilation was successful.
 */
async initWebgl(compilePolicy = SdfCanvas.COMPILE_POLICY_ALSO_BLOCKING);

/**
 * Renders the WebGL scene.
 * If a scissor bounding box is provided, the WebGL scissor test is enabled, 
 * restricting fragment shader execution and clearing operations to that specific 
 * rectangular area. The scissor coordinates are expected to be in standard DOM 
 * space (top-down Y axis) and are automatically mapped to WebGL buffer space.
 *  
 * @param {{x: number, y: number, w: number, h: number} | null} [scissor=null] - The bounding box for the scissor test.
 * For this function to work correctly, if `scissor` is not null, it MUST be an object containing the following numeric properties:
 * - `x`: The X coordinate of the top-left corner in DOM pixels.
 * - `y`: The Y coordinate of the top-left corner in DOM pixels.
 * - `w`: The width of the scissor box in DOM pixels.
 * - `h`: The height of the scissor box in DOM pixels.
 */
draw(scissor = null);

/**
 * Add an overwriteLayer to the SdfCanvas. This canvas will then use this overwriteLayer's properties instead of the global SdfLayer properties.
 * @param {number} index - Index of the layer to overwrite.
 * @param {SdfLayer} overwriteLayer - SdfLayer object that overwrites that layer.
 */
addOverwriteLayer(index, overwriteLayer);

/**
 * Removes an overwriteLayer from the SdfCanvas. 
 * @param {number} index - Index of the overwriteLayer to remove.
 */
removeOverwriteLayer(index);
```

> [!NOTE]
> If you want to change the area that the camera draws often (e.g., every frame), do not change the width and height of the canvas directly. Instead, use the `scissor` parameter of the `draw` function. If you change the width and height of the canvas directly, the canvas context is dropped and has to be rebuilt, which tanks performance.

### Compile Time Constants
There are a few variables that can only be changed **before** calling `initWebgl()`. These are:

* **useAA:** Enables Anti-Aliasing. This program uses Multisample Anti-Aliasing with four samples. 
> [!NOTE]
> Enabling Anti-Aliasing massively decreases performance because all calculations need to be performed four times. Additionally, compile time increases when enabling it. Therefore, it is suggested to only turn on Anti-Aliasing when using the 2D mode, because performance costs and compile times are massively reduced by default in 2D. 

* **twoDMode:** Enables a 2D mode, where instead of tracing a ray through the scene, the SDF is only evaluated once at a z-depth of 0. The `--z` property of elements is disregarded in this mode. 

* **useCustomShadeFunction:** Enables the use of a custom `shade` function to control the exact look of the scene. Otherwise, the scene is shaded as described below in the Shading section. If a custom shading function is used, it has to be stored as a string in the `customShadeFunction` member of the `sdfCanvas` object. This custom shade function takes the traced position as an input and returns the color that should be rendered at that point. It has to be of the following format:
  
```glsl
vec4 shade(Surface surface); // if twoDMode is used
vec4 shade(HitInfo hit);     // if the normal 3D mode is used

// The Structs are defined as follows:
struct Surface {
    vec3 colorDiffuse;
    float kd;           // diffuse material property
    vec3 colorSpecular;
    float ks;           // specular material property
    vec3 colorAmbient;
    float ka;          // ambient material property
    float p;           // specular exponent (specular fall off)
    float mix;         // mix factor (if this is ~0 or ~1 we are on the surface of an object)
    float distance;    // distance to the nearest surface
};

struct HitInfo {
    vec3 pos;          // position of the surface point
    int id;            // amount of steps of sphere-tracing; or -1 if it missed
    vec3 normal;       // normal of the surface point
    Surface surface;   // blended surface at the surface point
};

// To pass global values you can use (repurpose) the lights in the scene. These are stored in the array:
vec4 lightData[MAX_NUM_LIGHTS * VEC4_PER_LIGHT]; // VEC4_PER_LIGHT is 2
uniform int uNumLights; // number of lights in the array

// You can get the values of individual lights like so:
int   lightIdx   = 0;
vec3  lightPos   = lightData[lightIdx].xyz; // this stores the light direction if the light is a directional light
vec3  lightColor = unpackColor(lightData[lightIdx].w);
float intensity  = lightData[lightIdx + 1].x;
float radius     = lightData[lightIdx + 1].y;
float lightType  = lightData[lightIdx + 1].z; // 0 for point light, 1 for directional light
```
* **customElements:** You can define custom elements by setting the **static** `customElements` member variable of the `SdfCanvas` object. This is an array of arrays of 2D points that define the vertices of custom elements in object space. See below how to use the custom elements.
```js
SdfCanvas.customElements = [
    [[-0.5, 0], [0.5, 0], [0.5, 0.5]],
    [[-1.5, 0], [1.5, 0], [0.3, 2.5], [0.1, 0.5]],
];
```
> [!NOTE]
> The more custom elements you define, the longer compile times will be, because each custom element adds one branch to the map function. Therefore, you should only add the minimum necessary amount of custom elements.


## Layers

The SDF elements are placed in layers that control how the elements are added to the scene / blended onto already existing elements in the scene. These layers are static to `SdfCanvas` and can be set via the static `layers` member like so:
```js
SdfCanvas.layers = [new SdfLayer(SdfCommands.SMOOTH_UNION, 100)];
```

The layer an element is on can be controlled with the `data-layer-index` property of the HTML element. E.g.:

```html
<sdf-box-simple id="test-sdf-box-simple" data-layer-index="1">Simple Box</sdf-box-simple>
```

The layer is an index. First, all elements in the lowest layer are added to the scene, then the ones from the next layer, etc.

The elements are always blended with the defined `LayerOperation`:

```js
export const SdfCommands = Object.freeze({
    // ...
    // Layer Operations
    UNION: 100,
    SUBTRACTION: 101,
    INTERSECTION: 102,
    XOR: 103,
    SMOOTH_UNION: 104,
    SMOOTH_SUBTRACTION: 105,
    SMOOTH_INTERSECTION: 106,
    // ...
})
```

The smooth operations also have a corresponding `smoothingFactor` per layer to control the amount of smoothing.

To control the layers on a per-canvas basis, you can use the `addOverwriteLayer(index, overwriteLayer)` and `removeOverwriteLayer(index)` functions that define an "overwriteLayer" at the specified index that is used instead of the static layer at that index.

## Render Layers

To constrain certain elements to certain canvases, each canvas has a list of render-layer indices (`renderLayers`) that are compared to the render-layers of the elements. You can define those `data-render-layers` per element like so:

```html
<sdf-sphere class="test-sdf-sphere" data-render-layers="0" data-layer-index="1">Sphere</sdf-sphere>
```

An element can have multiple canvas indices signaled by a space between the two.   

```html
<sdf-sphere class="test-sdf-sphere" data-render-layers="0 1" data-layer-index="1">Sphere</sdf-sphere>
```

While rendering, they now only render elements that share a common render layer. E.g., if an element has the render layers `[0, 4, 5]` and a canvas renders the layers `[1, 2, 3]`, then that canvas will not render the element. But if the canvas rendered the layers `[0, 2, 3]` instead, the element would be rendered. 

**Lights** use the exact same principle. They also have a `data-render-layers` property and are only rendered by canvases with whom they share at least one common render layer.

By default, all elements and canvases have their render-layers set to `0` (meaning all canvases render everything).

## CSS Values
Most of the properties (both of geometry and shading) of the SDF elements are controlled by custom CSS properties. This was done because properties can easily be shared with the use of classes and animated with the built-in transition and animation capabilities. 

>[!NOTE]
>All the custom CSS values have `inherit: false`. 
>To animate the custom properties you have to explicitly use `transition: --property 0.1s;` (`transition: all 0.1s;` does not work).

## Supported Elements

The position of each element is computed from its position on the page. The elements have additional properties to control their specific attributes.

The z-position (the more positive the higher on the page, like z-index, but as a float) is controlled by the CSS property `--z`. The z-value controls the z-value of the center of the object. 

All objects can be rotated, translated, or skewed (in 2D or 3D) with the CSS `transform` property (e.g., `rotate`, `rotate3d`, `translate`, etc.).

All elements also support the `active` dataset-value:

```html
<sdf-sphere id="shpere" data-active="false">Sphere</sdf-sphere>
```

If an element is marked as not active it is rendered in no canvas. The default value is `true`. The active property can be modified in javaScript like so:

```js
const s = document.getElementById("shere");
s.active = false;
console.log(s.active);
```

The supported primitive objects are:

> [!IMPORTANT]
> For all elements with border roundings, keep in mind that in order for the element to be rendered correctly the width/height/depth has to be large enough. E.g., if you have `border-radius: 5rem;` with `width: 7rem;` then the element is not rendered correctly because it is not wide enough.

### 1. Sphere 
A normal sphere.
```html
<sdf-sphere id="test-sdf-sphere" data-layer-index="1">Sphere</sdf-sphere>
```

| Property | Description                        |
| -------- | ---------------------------------- |
| `--r`    | Controls the radius of the sphere. |

### 2. Simple Box
A simple box with width, height, and depth.
```html
<sdf-box-simple id="test-sdf-box-simple" data-layer-index="1">Simple Box</sdf-box-simple>
```

| Property          | Description                                                           |
| ----------------- | --------------------------------------------------------------------- |
| `width`, `height` | Control the width and height of the box.                              |
| `--depth`         | Controls the depth of the box.                                        |
| `--extrude`       | Extrudes all surfaces along their normal. Allows for rounded corners. |

### 3. Box
A more general box that also supports `border-radius`.
```html
<sdf-box id="test-sdf-box" data-layer-index="1">Box with rounded corners</sdf-box>
```

| Property                     | Description                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `width`, `height`, `--depth` | Controlled in the same way as for the simple box.                                                                                                                                                                                                                                                                                                                                                                        |
| `border-radius`              | Controls the border radius (same as normal CSS). May be different for each corner.                                                                                                                                                                                                                                                                                                                                       |
| `--border-radius-type`       | Controls the type of the radius (see [this article](https://iquilezles.org/articles/roundedboxes/)). Available options: <br> • `circle`: Default.<br> • `parabola`: Smoother than circle.<br> • `cosine`: Uses Cosine similarity to fix second-derivative discontinuities. *More computationally expensive (uses binary search).*<br> • `cubic`: Also provides continuous second derivatives. *Also uses binary search.* |
| `--rotation-offset`          | Controls the initial rotation of the box (axis around which corners are rounded). Can be `z` (default), `x`, or `y`.                                                                                                                                                                                                                                                                                                     |
| `--extrude`                  | Extrudes all surfaces along their normal. Allows for rounded corners.                                                                                                                                                                                                                                                                                                                                                    |

### 4. Text
An element containing text which is rendered as SDF elements. As of now, there is one supported font, **metaballs** (only lower case letters and numbers for now). All the letters inside one `<sdf-text>` element will have the same material and size. Sdf-text elements support `letter-spacing`, `word-spacing`, and `word-break`.

```html
<sdf-text id="test-sdf-box-round" data-layer-index="1">Text</sdf-text>
```

| Property             | Description                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--depth`            | Controls the depth of the letters.                                                                                                                 |
| `--letterSmoothness` | Controls the smoothing between individual letters, which are internally combined using a `SMOOTH_UNION` function. A value of 0 means no smoothing. |
| `--extrude`          | Extrudes all surfaces along their normal. Allows for rounded corners.                                                                              |

### 5. Cylinder
A cylinder.

```html
<sdf-cylinder id="test-sdf-cylinder" data-layer-index="2">Cylinder</sdf-cylinder>
```

| Property    | Description                                                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--axis`    | Controls along which axis the cylinder is formed. Can be `x`, `y`, or `z`. Depending on this value, `width`, `height`, and `--depth` control the height and the radius of the cylinder. |
| `--extrude` | Extrudes all surfaces along their normal. Allows for rounded corners.                                                                                                                   |

### 6. Triangle
An arbitrary triangle.
```html
<sdf-triangle id="test-sdf-triangle" data-layer-index="2">Triangle</sdf-triangle>
```
| Property                              | Description                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `--point-a`, `--point-b`, `--point-c` | The three vertices of the triangle. They are `vec2` values set in CSS (e.g., `--point-a: -5rem -5rem;`). |
| `--depth`                             | Controls the depth of the triangle.                                                                      |
| `--extrude`                           | Extrudes all surfaces along their normal. Allows for rounded corners.                                    |

### 7. Custom Elements
Arbitrary 2D polygons that are extruded along the local z-axis. You have to define the shape before initializing the WebGL canvas (see [Compile Time Constants](#compile-time-constants)). 

```html
<sdf-custom id="test-sdf-custom" data-custom-index="0" data-layer-index="2"></sdf-custom>
```

| Property / Attribute | Description                                                                                                                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-custom-index`  | HTML attribute that controls which of the previously defined polygons this element should be rendered as. E.g. a value of 1 would use the shape defined in `SdfCanvas.customElements[1]`. *This is NOT a CSS property, but a HTML Attribute. (see example above)* |
| `--scale`            | Controls the scale of the custom elements. E.g., if scale is set to `10rem`, then 1 unit of object space will appear to be `10rem` on the screen.                                                                                                                 |
| `--depth`            | Controls the depth of the polygon.                                                                                                                                                                                                                                |
| `--extrude`          | Extrudes all surfaces along their normal. Allows for rounded corners.                                                                                                                                                                                             |

## Lights
Lights are controlled similar to elements (they also support the `data-render-layers` and `data-active` properties). You have to create an HTML element that represents the light:
```html
<sdf-light data-render-layers="0">Directional Light</sdf-light>
```

| CSS Property        | Description                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--diffuse-color`   | Color of the light.                                                                                                        |
| `--light-intensity` | Intensity of the light.                                                                                                    |
| `--light-type`      | Can be `point` or `directional`. Controls if the light has a position and falloff, or just a direction without falloff.    |
| `--light-direction` | Three-component value representing the direction of the light for directional lights (e.g., `--light-direction: 1 1 -1;`). |
| `--radius`          | Represents the radius of the light for point lights. Things further away than this are not illuminated by this light.      |

## Modifiers
You can add modifiers to SDF elements to alter their appearance. As of now, there is only one supported modifier. You can add modifiers to elements like so:

```js
const sdfElement = document.querySelector("#element-name");
const target = document.querySelector("#target");
sdfElement.addModifier(new Twist(target));
```

### Twist
Add a twist to the selected element. The twist is controlled by a **target** element, which is an HTML element passed into the constructor. This target element expects the following CSS properties:

| CSS Property    | Description                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `--twist-axis`  | 3D vector that controls the axis around which the twist is applied (e.g., `--twist-axis: 0 1 0;`).                                    |
| `--twist-rate`  | The twist rate. Measured in revolutions per `rem`. A rate of `0.1` means a `10rem` element twists exactly once around `--twist-axis`. |
| `--twist-start` | The distance along the twist axis up to which the twist is applied normally. From here to `--twist-end`, the twist tapers off.        |
| `--twist-end`   | The distance where the twist tapers off and stops entirely.                                                                           |

## Shading

All SDF elements should have the following CSS properties to control their material rendering:

| CSS Property       | Parameter | Description                                               |
| ------------------ | --------- | --------------------------------------------------------- |
| `--diffuse-color`  | $C_d$     | Controls the diffuse color of the object.                 |
| `--specular-color` | $C_s$     | Controls the specular color of the object.                |
| `--ambient-color`  | $C_a$     | Controls the ambient color of the object.                 |
| `--kd`             | $k_d$     | Controls the diffuse parameter (weight) of the object.    |
| `--ks`             | $k_s$     | Controls the specular parameter (weight) of the object.   |
| `--p`              | $p$       | Controls the specular exponent (shininess) of the object. |
| `--ka`             | $k_a$     | Controls the ambient parameter (weight) of the object.    |

These are used to calculate the final color ($C$) of a point on the surface with normal $\vec{n}$, vector towards the light source $\vec{l}$, and the view vector towards the camera $\vec{v}$. The default shading function uses the **Phong shading model** to calculate the final color:

$$
I_d = k_d \cdot \max(\vec{n} \cdot \vec{l}, 0)
$$

$$
I_s = k_s \cdot \max(\text{reflect}(\vec{l}, \vec{n}) \cdot \vec{v}, 0)^{p}
$$

$$
C = I_d \cdot C_d + I_s \cdot C_s + k_a \cdot C_a
$$

Where $\text{reflect}$ calculates the perfect reflection direction of $\vec{l}$ when reflected along $\vec{n}$.

This behavior can be overwritten by defining a custom shading function (see [Compile Time Constants](#compile-time-constants)).