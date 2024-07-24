/**
 * 模板化
 * @param {string} templateId - 模板 ID
 * @param {Object} parameters - 参数对象
 * @returns {HTMLElement} - 模板化后的元素
 */
let cloneId = 0;
export function templatize(templateId, parameters) {
  let clone = document.getElementById(templateId).cloneNode(true);
  clone.id = "template_clone_" + cloneId++;
  if (!parameters) {
    return clone;
  }
  applyTemplateSubstitutions(clone, parameters);
  return clone;
}

/**
 * 应用模板替换
 * @param {HTMLElement} node - 节点元素
 * @param {Object} parameters - 参数对象
 */
function applyTemplateSubstitutions(node, parameters) {
  const attributes = node.getAttributeNames();
  for (var ii = 0; ii < attributes.length; ii++) {
    const attr = attributes[ii];
    const attrVal = node.getAttribute(attr);
    node.setAttribute(attr, templatizeString(attrVal, parameters));
  }
  if (node.childElementCount == 0) {
    node.innerText = templatizeString(node.innerText, parameters);
  } else {
    const children = Array.from(node.children);
    children.forEach((n) => {
      applyTemplateSubstitutions(n, parameters);
    });
  }
}

/**
 * 模板字符串化
 * @param {string} text - 文本
 * @param {Object} parameters - 参数对象
 * @returns {string} - 字符串化后的文本
 */
function templatizeString(text, parameters) {
  if (parameters) {
    for (const [key, val] of Object.entries(parameters)) {
      text = text.replaceAll("$" + key, val);
    }
  }
  return text;
}

/**
 * 创建一个指定标签的元素
 * @param {string} tag - 标签
 * @param {string} className - 类名
 * @returns {HTMLElement} - 元素
 */
export function create(tag, className = "") {
  let element = document.createElement(tag);
  element.className = className;
  return element;
}