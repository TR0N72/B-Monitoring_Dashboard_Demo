import os
import re
def remove_comments_js_css(content):
    content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
    content = re.sub(r'//.*', '', content)
    return content
def remove_comments_html(content):
    return re.sub(r'<!--.*?-->', '', content, flags=re.DOTALL)
def remove_comments_py(content):
    content = re.sub(r'
    content = re.sub(r'', '', content, flags=re.DOTALL)
    content = re.sub(r"", '', content, flags=re.DOTALL)
    return content
def remove_comments_sql(content):
    content = re.sub(r'--.*', '', content)
    content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
    return content
def remove_comments_yml_env(content):
    return re.sub(r'
def process_file(filepath):
    _, ext = os.path.splitext(filepath)
    ext = ext.lower()
    if ext in ['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.zip', '.exe', '.dll', '.ico']:
        return
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception:
        return
    if ext in ['.js', '.css']:
        new_content = remove_comments_js_css(content)
    elif ext in ['.html', '.htm']:
        new_content = remove_comments_html(content)
    elif ext == '.py':
        new_content = remove_comments_py(content)
    elif ext == '.sql':
        new_content = remove_comments_sql(content)
    elif ext in ['.yml', '.yaml', '.env']:
        new_content = remove_comments_yml_env(content)
    else:
        if ext in ['.sh', '.bash']:
             new_content = remove_comments_yml_env(content)
        else:
            return
    lines = [line.rstrip() for line in new_content.splitlines()]
    final_lines = [line for line in lines if line]
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write("\n".join(final_lines) + '\n')
def main():
    workspace = 'c:\\CApstone'
    exclude_dirs = {'.git', 'node_modules', '.gemini', 'document'}
    for root, dirs, files in os.walk(workspace):
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        for file in files:
            process_file(os.path.join(root, file))
if __name__ == "__main__":
    main()
