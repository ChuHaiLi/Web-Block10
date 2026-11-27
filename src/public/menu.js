const menus = Array.from(document.querySelectorAll('.header-menu'));

function closeMenus(except, returnFocus)
{
    for (const menu of menus)
    {
        if (menu === except || !menu.open) continue;
        menu.open = false;
        if (returnFocus) menu.querySelector('summary').focus();
    }
}

for (const menu of menus)
{
    menu.addEventListener('toggle', () =>
    {
        if (menu.open) closeMenus(menu, false);
    });
}

document.addEventListener('click', event =>
{
    for (const menu of menus)
    {
        if (menu.open && !menu.contains(event.target)) menu.open = false;
    }
});

document.addEventListener('keydown', event =>
{
    if (event.key === 'Escape') closeMenus(null, true);
});
